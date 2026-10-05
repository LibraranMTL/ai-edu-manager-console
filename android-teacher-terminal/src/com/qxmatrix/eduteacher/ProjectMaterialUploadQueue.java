package com.qxmatrix.eduteacher;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.UUID;

/**
 * Durable, item-scoped upload queue used by the Android teacher terminal.
 *
 * The queue deliberately has no Android dependency.  It owns a private stable
 * copy of every pending payload and persists one small state file per item, so
 * the state machine can be exercised by a regular JVM test as well as Android.
 * A selected student in the UI is never consulted after enqueue: host, device,
 * student, project, request id and content hash are immutable queue fields.
 */
final class ProjectMaterialUploadQueue {
    static final String STATE_PENDING = "pending";
    static final String STATE_QUERYING = "querying_receipt";
    static final String STATE_UPLOADING = "uploading";
    static final String STATE_RECEIPT_UNKNOWN = "receipt_unknown";
    static final String STATE_RETRYABLE = "retryable";
    static final String STATE_PAUSED_AUTH = "paused_auth";
    static final String STATE_PAUSED_SCOPE = "paused_scope";
    static final String STATE_FAILED = "failed";
    static final String STATE_RECEIVED = "received";

    static final String RECEIPT_VERIFIED = "received_verified";
    static final String RECEIPT_NOT_FOUND = "not_found";
    static final String RECEIPT_UNAVAILABLE = "received_unavailable";
    static final String RECEIPT_SCOPE_UNVERIFIABLE = "scope_unverifiable";

    private static final String FORMAT_VERSION = "1";
    private static final int BUFFER_SIZE = 32 * 1024;

    interface Source {
        InputStream open() throws Exception;
    }

    interface Transport {
        ReceiptResult queryReceipt(Item item) throws QueueTransportException;
        UploadResult upload(Item item, File stablePayload) throws QueueTransportException;
    }

    static final class QueueTransportException extends Exception {
        final String code;
        final boolean authorizationFailure;
        final boolean resultUnknown;
        final boolean receiptUnsupported;
        final boolean retryable;

        QueueTransportException(String code, String message, boolean authorizationFailure,
                                boolean resultUnknown, boolean receiptUnsupported, boolean retryable) {
            super(message == null ? code : message);
            this.code = clean(code);
            this.authorizationFailure = authorizationFailure;
            this.resultUnknown = resultUnknown;
            this.receiptUnsupported = receiptUnsupported;
            this.retryable = retryable;
        }

        static QueueTransportException auth(String message) {
            return new QueueTransportException("authorization_failed", message, true, false, false, false);
        }

        static QueueTransportException unknown(String message) {
            return new QueueTransportException("result_unknown", message, false, true, false, true);
        }

        static QueueTransportException unknown(String code, String message) {
            return new QueueTransportException(code, message, false, true, false, true);
        }

        static QueueTransportException receiptUnsupported(String message) {
            return new QueueTransportException("receipt_query_unsupported", message, false, false, true, false);
        }

        static QueueTransportException retryable(String code, String message) {
            return new QueueTransportException(code, message, false, false, false, true);
        }

        static QueueTransportException permanent(String code, String message) {
            return new QueueTransportException(code, message, false, false, false, false);
        }
    }

    static final class EnqueueRequest {
        String hostId;
        String hostBaseUrl;
        String dataGeneration;
        String deviceId;
        String studentId;
        String targetType;
        String targetId;
        String targetName;
        String filename;
        String sourceType;
        String extraQuery;
        String requestId;
        long createdAt;
    }

    static final class ReceiptResult {
        final String status;
        final String hostId;
        final String dataGeneration;
        final String targetType;
        final String targetId;
        final String studentId;
        final String receiptId;
        final long size;
        final String sha256;
        final String materialId;
        final int materialVersion;

        ReceiptResult(String status, String hostId, String dataGeneration,
                      String targetType, String targetId, String studentId,
                      String receiptId, long size, String sha256,
                      String materialId, int materialVersion) {
            this.status = clean(status);
            this.hostId = clean(hostId);
            this.dataGeneration = clean(dataGeneration);
            this.targetType = clean(targetType);
            this.targetId = clean(targetId);
            this.studentId = clean(studentId);
            this.receiptId = clean(receiptId);
            this.size = size;
            this.sha256 = clean(sha256).toLowerCase(Locale.ROOT);
            this.materialId = clean(materialId);
            this.materialVersion = Math.max(0, materialVersion);
        }
    }

    static final class UploadResult {
        final String receiptStatus;
        final String hostId;
        final String dataGeneration;
        final String targetType;
        final String targetId;
        final String studentId;
        final String receiptId;
        final long size;
        final String sha256;
        final String materialId;
        final int materialVersion;
        final boolean legacyResponse;

        UploadResult(String receiptStatus, String hostId, String dataGeneration, String targetType, String targetId,
                     String studentId, String receiptId, long size, String sha256,
                     String materialId, int materialVersion, boolean legacyResponse) {
            this.receiptStatus = clean(receiptStatus);
            this.hostId = clean(hostId);
            this.dataGeneration = clean(dataGeneration);
            this.targetType = clean(targetType);
            this.targetId = clean(targetId);
            this.studentId = clean(studentId);
            this.receiptId = clean(receiptId);
            this.size = size;
            this.sha256 = clean(sha256).toLowerCase(Locale.ROOT);
            this.materialId = clean(materialId);
            this.materialVersion = Math.max(0, materialVersion);
            this.legacyResponse = legacyResponse;
        }
    }

    static final class RuntimeScope {
        final String hostId;
        final String dataGeneration;
        final String deviceId;
        final String baseUrl;
        final boolean credentialVerified;

        RuntimeScope(String hostId, String dataGeneration, String deviceId,
                     String baseUrl, boolean credentialVerified) {
            this.hostId = clean(hostId);
            this.dataGeneration = clean(dataGeneration);
            this.deviceId = clean(deviceId);
            this.baseUrl = normalizeBaseUrl(baseUrl);
            this.credentialVerified = credentialVerified;
        }

        boolean complete() {
            return hostId.length() > 0 && dataGeneration.length() > 0
                && deviceId.length() > 0 && baseUrl.length() > 0 && credentialVerified;
        }
    }

    static final class UiScope {
        final long selectionGeneration;
        final String studentId;
        final String targetType;
        final String targetId;
        final String baseUrl;
        final String credentialFingerprint;
        volatile String hostId;
        volatile String dataGeneration;

        UiScope(long selectionGeneration, String studentId, String targetType, String targetId,
                String baseUrl, String credentialFingerprint) {
            this.selectionGeneration = selectionGeneration;
            this.studentId = clean(studentId);
            this.targetType = clean(targetType);
            this.targetId = clean(targetId);
            this.baseUrl = normalizeBaseUrl(baseUrl);
            this.credentialFingerprint = clean(credentialFingerprint);
            this.hostId = "";
            this.dataGeneration = "";
        }

        void bindRuntime(RuntimeScope runtime) {
            hostId = runtime == null ? "" : runtime.hostId;
            dataGeneration = runtime == null ? "" : runtime.dataGeneration;
        }

        boolean matches(long currentSelectionGeneration, String currentStudentId,
                        String currentTargetType, String currentTargetId,
                        String currentBaseUrl, String currentCredentialFingerprint,
                        String currentHostId, String currentDataGeneration) {
            return selectionGeneration == currentSelectionGeneration
                && studentId.length() > 0 && studentId.equals(clean(currentStudentId))
                && targetType.equals(clean(currentTargetType))
                && targetId.equals(clean(currentTargetId))
                && baseUrl.equals(normalizeBaseUrl(currentBaseUrl))
                && credentialFingerprint.length() > 0
                && credentialFingerprint.equals(clean(currentCredentialFingerprint))
                && (hostId.length() == 0 || (hostId.equals(clean(currentHostId))
                    && dataGeneration.length() > 0
                    && dataGeneration.equals(clean(currentDataGeneration))));
        }
    }

    static final class Item {
        final String requestId;
        final String hostId;
        final String hostBaseUrl;
        final String dataGeneration;
        final String deviceId;
        final String studentId;
        final String targetType;
        final String targetId;
        final String targetName;
        final String filename;
        final String sourceType;
        final String extraQuery;
        final String payloadName;
        final long size;
        final String sha256;
        final long createdAt;
        final String state;
        final int attempts;
        final long updatedAt;
        final String lastCode;
        final String lastMessage;
        final String receiptHostId;
        final String receiptGeneration;
        final String materialId;
        final int materialVersion;
        final boolean legacyReceipt;

        private Item(Properties value) {
            requestId = value.getProperty("requestId", "");
            hostId = value.getProperty("hostId", "");
            hostBaseUrl = value.getProperty("hostBaseUrl", "");
            dataGeneration = value.getProperty("dataGeneration", "");
            deviceId = value.getProperty("deviceId", "");
            studentId = value.getProperty("studentId", "");
            targetType = value.getProperty("targetType", "");
            targetId = value.getProperty("targetId", "");
            targetName = value.getProperty("targetName", "");
            filename = value.getProperty("filename", "");
            sourceType = value.getProperty("sourceType", "android_teacher_terminal_file");
            extraQuery = value.getProperty("extraQuery", "");
            payloadName = value.getProperty("payloadName", "");
            size = number(value.getProperty("size"), -1L);
            sha256 = value.getProperty("sha256", "");
            createdAt = number(value.getProperty("createdAt"), 0L);
            state = value.getProperty("state", STATE_PENDING);
            attempts = (int) number(value.getProperty("attempts"), 0L);
            updatedAt = number(value.getProperty("updatedAt"), createdAt);
            lastCode = value.getProperty("lastCode", "");
            lastMessage = value.getProperty("lastMessage", "");
            receiptHostId = value.getProperty("receiptHostId", "");
            receiptGeneration = value.getProperty("receiptGeneration", "");
            materialId = value.getProperty("materialId", "");
            materialVersion = (int) number(value.getProperty("materialVersion"), 0L);
            legacyReceipt = Boolean.parseBoolean(value.getProperty("legacyReceipt", "false"));
        }

        boolean isTerminal() {
            return STATE_RECEIVED.equals(state) || STATE_FAILED.equals(state);
        }

        boolean needsAttention() {
            return STATE_RECEIPT_UNKNOWN.equals(state) || STATE_PAUSED_AUTH.equals(state)
                || STATE_PAUSED_SCOPE.equals(state) || STATE_FAILED.equals(state);
        }
    }

    static final class BatchResult {
        int examined;
        int received;
        int waiting;
        int unknown;
        int failed;
        int pausedAuthorization;
        boolean stoppedForAuthorization;
    }

    private final File root;
    private final File recordsDir;
    private final File payloadsDir;
    private final long maxPayloadBytes;

    ProjectMaterialUploadQueue(File root, long maxPayloadBytes) throws Exception {
        this.root = requireDirectoryRoot(root);
        this.recordsDir = new File(this.root, "records");
        this.payloadsDir = new File(this.root, "payloads");
        this.maxPayloadBytes = maxPayloadBytes > 0 ? maxPayloadBytes : 100L * 1024L * 1024L;
        ensureDirectory(this.recordsDir);
        ensureDirectory(this.payloadsDir);
        recoverSidecars();
    }

    synchronized Item enqueue(EnqueueRequest request, Source source) throws Exception {
        validateRequest(request);
        if (source == null) throw new Exception("upload source is required");
        String requestId = clean(request.requestId);
        if (requestId.length() == 0) requestId = newRequestId();
        if (!safeId(requestId)) throw new Exception("invalid upload request id");
        File recordFile = recordFile(requestId);
        if (recordFile.exists()) {
            Item existing = read(recordFile);
            assertSameScope(existing, request);
            return existing;
        }

        String payloadName = requestId + ".payload";
        File payload = new File(payloadsDir, payloadName);
        File pendingPayload = new File(payloadsDir, payloadName + ".partial");
        if (payload.exists() || pendingPayload.exists()) throw new Exception("upload payload identity already exists");
        long size = 0L;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        InputStream input = null;
        OutputStream output = null;
        try {
            input = new BufferedInputStream(source.open());
            if (input == null) throw new Exception("cannot open upload source");
            FileOutputStream fileOutput = new FileOutputStream(pendingPayload);
            output = new BufferedOutputStream(fileOutput);
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) {
                size += read;
                if (size > maxPayloadBytes) throw new Exception("upload payload exceeds queue limit");
                digest.update(buffer, 0, read);
                output.write(buffer, 0, read);
            }
            output.flush();
            fileOutput.getFD().sync();
        } catch (Exception error) {
            pendingPayload.delete();
            throw error;
        } finally {
            if (output != null) try { output.close(); } catch (Exception ignored) {}
            if (input != null) try { input.close(); } catch (Exception ignored) {}
        }
        if (!pendingPayload.renameTo(payload)) {
            pendingPayload.delete();
            throw new Exception("cannot publish stable upload payload");
        }

        long now = request.createdAt > 0 ? request.createdAt : System.currentTimeMillis();
        Properties value = new Properties();
        value.setProperty("formatVersion", FORMAT_VERSION);
        value.setProperty("requestId", requestId);
        value.setProperty("hostId", clean(request.hostId));
        value.setProperty("hostBaseUrl", normalizeBaseUrl(request.hostBaseUrl));
        value.setProperty("dataGeneration", clean(request.dataGeneration));
        value.setProperty("deviceId", clean(request.deviceId));
        value.setProperty("studentId", clean(request.studentId));
        value.setProperty("targetType", clean(request.targetType));
        value.setProperty("targetId", clean(request.targetId));
        value.setProperty("targetName", clean(request.targetName));
        value.setProperty("filename", clean(request.filename));
        value.setProperty("sourceType", clean(request.sourceType).length() == 0
            ? "android_teacher_terminal_file" : clean(request.sourceType));
        value.setProperty("extraQuery", clean(request.extraQuery));
        value.setProperty("payloadName", payloadName);
        value.setProperty("size", String.valueOf(size));
        value.setProperty("sha256", hex(digest.digest()));
        value.setProperty("createdAt", String.valueOf(now));
        value.setProperty("updatedAt", String.valueOf(now));
        boolean fixedScope = clean(request.hostId).length() > 0 && clean(request.dataGeneration).length() > 0;
        value.setProperty("state", fixedScope ? STATE_PENDING : STATE_RECEIPT_UNKNOWN);
        if (!fixedScope) {
            value.setProperty("lastCode", "host_scope_missing");
            value.setProperty("lastMessage", "当前主机未提供可核验的身份或资料代次；已保留本机稳定副本，等待人工核对。");
        }
        value.setProperty("attempts", "0");
        try {
            writeRecord(recordFile, value);
        } catch (Exception error) {
            payload.delete();
            throw error;
        }
        return new Item(value);
    }

    synchronized List<Item> recoverInterrupted() throws Exception {
        List<Item> items = list();
        List<Item> recovered = new ArrayList<Item>();
        for (Item item : items) {
            if (STATE_QUERYING.equals(item.state)) {
                recovered.add(update(item, STATE_RETRYABLE, "app_restarted_during_receipt_query",
                    "应用在查询回执时退出，将重新查询。", null, false));
            } else if (STATE_UPLOADING.equals(item.state)) {
                recovered.add(update(item, STATE_RECEIPT_UNKNOWN, "app_restarted_during_upload",
                    "应用在上传过程中退出，必须先核对原请求回执。", null, false));
            } else {
                recovered.add(item);
            }
        }
        return recovered;
    }

    synchronized List<Item> list() throws Exception {
        recoverSidecars();
        ArrayList<Item> result = new ArrayList<Item>();
        File[] files = recordsDir.listFiles();
        if (files != null) {
            for (File file : files) {
                if (!file.isFile() || !file.getName().endsWith(".properties")) continue;
                result.add(read(file));
            }
        }
        Collections.sort(result, new Comparator<Item>() {
            @Override public int compare(Item left, Item right) {
                int byTime = Long.compare(left.createdAt, right.createdAt);
                return byTime != 0 ? byTime : left.requestId.compareTo(right.requestId);
            }
        });
        return result;
    }

    synchronized BatchResult process(Transport transport, RuntimeScope runtime, int limit) throws Exception {
        if (transport == null) throw new Exception("upload transport is required");
        if (runtime == null || !runtime.complete()) throw new Exception("verified runtime upload scope is required");
        BatchResult batch = new BatchResult();
        List<Item> items = list();
        int remaining = limit <= 0 ? Integer.MAX_VALUE : limit;
        for (Item item : items) {
            if (remaining <= 0) break;
            if (STATE_RECEIVED.equals(item.state)) {
                batch.received++;
                continue;
            }
            if (STATE_FAILED.equals(item.state)) {
                batch.failed++;
                continue;
            }
            if (STATE_PAUSED_AUTH.equals(item.state)) {
                batch.pausedAuthorization++;
                continue;
            }
            if (STATE_PAUSED_SCOPE.equals(item.state)) {
                batch.failed++;
                continue;
            }
            remaining--;
            batch.examined++;
            if (item.hostId.length() == 0 || item.dataGeneration.length() == 0) {
                batch.unknown++;
                continue;
            }
            if (!sameRuntimeScope(item, runtime)) {
                update(item, STATE_RECEIPT_UNKNOWN, "runtime_scope_changed",
                    "当前运行主机、资料代次或设备凭据与排队时不一致；未联系旧主机，也未发送资料。", null, false);
                batch.unknown++;
                continue;
            }
            ProcessResult result = processOne(item, transport);
            if (result.received) batch.received++;
            else if (result.authorizationPaused) {
                batch.pausedAuthorization++;
                batch.stoppedForAuthorization = true;
                break;
            } else if (result.unknown) batch.unknown++;
            else if (result.failed) batch.failed++;
            else batch.waiting++;
        }
        return batch;
    }

    synchronized int resumeAuthorization(String hostId, String deviceId) throws Exception {
        if (clean(hostId).length() == 0 || clean(deviceId).length() == 0) return 0;
        int changed = 0;
        for (Item item : list()) {
            if (!STATE_PAUSED_AUTH.equals(item.state)) continue;
            if (item.hostId.length() == 0 || item.deviceId.length() == 0
                || !clean(hostId).equals(item.hostId) || !clean(deviceId).equals(item.deviceId)) continue;
            update(item, STATE_RETRYABLE, "", "授权已更新，等待重新查询原回执。", null, false);
            changed++;
        }
        return changed;
    }

    File payload(Item item) {
        if (item == null || !safePayloadName(item.payloadName)) return null;
        return new File(payloadsDir, item.payloadName);
    }

    private ProcessResult processOne(Item original, Transport transport) throws Exception {
        ProcessResult result = new ProcessResult();
        File stablePayload = payload(original);
        if (stablePayload == null || !stablePayload.isFile()) {
            update(original, STATE_FAILED, "stable_payload_missing",
                "本机待上传副本不存在，请重新选择原文件。", null, false);
            result.failed = true;
            return result;
        }
        Fingerprint actual = fingerprint(stablePayload);
        if (actual.size != original.size || !actual.sha256.equals(original.sha256)) {
            update(original, STATE_FAILED, "stable_payload_changed",
                "本机待上传副本已变化，已停止发送。", null, false);
            result.failed = true;
            return result;
        }

        boolean previouslyUnknown = STATE_RECEIPT_UNKNOWN.equals(original.state);
        Item querying = update(original, STATE_QUERYING, "", "正在核对原请求回执。", null, false);
        ReceiptResult receipt = null;
        try {
            receipt = transport.queryReceipt(querying);
        } catch (QueueTransportException error) {
            if (error.authorizationFailure) {
                update(querying, STATE_PAUSED_AUTH, error.code, error.getMessage(), null, false);
                result.authorizationPaused = true;
                return result;
            }
            if (error.receiptUnsupported) {
                if (previouslyUnknown) {
                    update(querying, STATE_RECEIPT_UNKNOWN, error.code,
                        "旧主机无法查询回执，未自动重传可能已经接收的资料。", null, false);
                    result.unknown = true;
                    return result;
                }
            } else {
                String nextState = (!error.retryable && !error.resultUnknown)
                    ? STATE_PAUSED_SCOPE : (previouslyUnknown ? STATE_RECEIPT_UNKNOWN : STATE_RETRYABLE);
                update(querying, nextState, error.code, error.getMessage(), null, false);
                result.unknown = previouslyUnknown || error.resultUnknown;
                result.failed = STATE_PAUSED_SCOPE.equals(nextState);
                return result;
            }
        }

        if (receipt != null) {
            String receiptProblem = receiptScopeProblem(querying, receipt,
                RECEIPT_VERIFIED.equals(receipt.status));
            if (receiptProblem.length() > 0) {
                update(querying, STATE_RECEIPT_UNKNOWN, receiptProblem,
                    "主机回执缺少字段或与固定主机、代次、学生、目标、请求或文件指纹不一致；未自动发送。",
                    receipt, false);
                result.unknown = true;
                return result;
            }
            if (RECEIPT_VERIFIED.equals(receipt.status)) {
                update(querying, STATE_RECEIVED, "", "主机已核验接收。", receipt, false);
                result.received = true;
                return result;
            }
            if (RECEIPT_UNAVAILABLE.equals(receipt.status)
                || RECEIPT_SCOPE_UNVERIFIABLE.equals(receipt.status)) {
                update(querying, STATE_RECEIPT_UNKNOWN, receipt.status,
                    "主机存在相关记录，但当前不能核验原件，未自动重传。", receipt, false);
                result.unknown = true;
                return result;
            }
            if (!RECEIPT_NOT_FOUND.equals(receipt.status)) {
                update(querying, STATE_RECEIPT_UNKNOWN, "unexpected_receipt_status",
                    "主机返回了无法识别的回执状态，已停止发送。", receipt, false);
                result.unknown = true;
                return result;
            }
        }

        Item uploading = update(querying, STATE_UPLOADING, "", "正在发送固定的本机副本。", null, true);
        try {
            UploadResult uploaded = transport.upload(uploading, stablePayload);
            assertUploadScope(uploading, uploaded);
            ReceiptResult accepted = new ReceiptResult(RECEIPT_VERIFIED, uploaded.hostId,
                uploaded.dataGeneration, uploaded.targetType, uploaded.targetId, uploaded.studentId,
                uploaded.receiptId, uploaded.size, uploaded.sha256,
                uploaded.materialId, uploaded.materialVersion);
            update(uploading, STATE_RECEIVED, "", "主机已持久接收并返回可核对的逐项回执。",
                accepted, false);
            result.received = true;
        } catch (QueueTransportException error) {
            if (error.authorizationFailure) {
                update(uploading, STATE_PAUSED_AUTH, error.code, error.getMessage(), null, false);
                result.authorizationPaused = true;
            } else if (error.resultUnknown || error.retryable) {
                update(uploading, STATE_RECEIPT_UNKNOWN, error.code,
                    "发送结果不确定，保留原请求并在下次先查询回执。" + clean(error.getMessage()), null, false);
                result.unknown = true;
            } else {
                update(uploading, STATE_FAILED, error.code, error.getMessage(), null, false);
                result.failed = true;
            }
        }
        return result;
    }

    private boolean sameRuntimeScope(Item item, RuntimeScope runtime) {
        return item != null && runtime != null && runtime.complete()
            && item.hostId.length() > 0 && item.dataGeneration.length() > 0 && item.deviceId.length() > 0
            && item.hostId.equals(runtime.hostId)
            && item.dataGeneration.equals(runtime.dataGeneration)
            && item.deviceId.equals(runtime.deviceId);
    }

    private Item update(Item item, String state, String code, String message,
                        ReceiptResult receipt, boolean incrementAttempts) throws Exception {
        Properties value = toProperties(item);
        value.setProperty("state", state);
        value.setProperty("updatedAt", String.valueOf(System.currentTimeMillis()));
        value.setProperty("lastCode", clean(code));
        value.setProperty("lastMessage", clean(message));
        if (incrementAttempts) value.setProperty("attempts", String.valueOf(item.attempts + 1));
        if (receipt != null) {
            value.setProperty("receiptHostId", receipt.hostId);
            value.setProperty("receiptGeneration", receipt.dataGeneration);
            value.setProperty("materialId", receipt.materialId);
            value.setProperty("materialVersion", String.valueOf(receipt.materialVersion));
        }
        if (STATE_RECEIVED.equals(state)) value.setProperty("legacyReceipt", String.valueOf(message != null && message.contains("旧版")));
        writeRecord(recordFile(item.requestId), value);
        Item updated = new Item(value);
        if (STATE_RECEIVED.equals(state)) {
            File stablePayload = payload(updated);
            if (stablePayload != null && stablePayload.isFile()) stablePayload.delete();
        }
        return updated;
    }

    private void assertUploadScope(Item item, UploadResult result) throws QueueTransportException {
        if (result == null) throw QueueTransportException.unknown("主机没有返回上传结果。");
        if (result.legacyResponse) throw QueueTransportException.unknown("legacy_receipt_unverifiable",
            "旧版主机返回成功，但没有完整逐文件回执；结果必须人工核对。");
        if (!RECEIPT_VERIFIED.equals(result.receiptStatus)) {
            throw QueueTransportException.unknown("receipt_status_missing", "上传响应缺少已核验回执状态。");
        }
        if (!sameHost(item, result.hostId)) throw QueueTransportException.unknown(
            "receipt_host_mismatch", "上传回执主机身份缺失或不一致。");
        if (generationChanged(item.dataGeneration, result.dataGeneration)) throw QueueTransportException.unknown(
            "receipt_generation_mismatch", "上传回执资料代次缺失或不一致。");
        if (!item.targetType.equals(result.targetType) || !item.targetId.equals(result.targetId)
            || !item.studentId.equals(result.studentId)) throw QueueTransportException.unknown(
                "receipt_scope_mismatch", "上传回执学生或目标范围缺失或不一致。");
        if (!item.requestId.equals(result.receiptId)) throw QueueTransportException.unknown(
            "receipt_identifier_mismatch", "上传回执缺少原请求编号或编号不一致。");
        if (item.size != result.size || !item.sha256.equals(result.sha256)) throw QueueTransportException.unknown(
            "receipt_fingerprint_mismatch", "上传回执文件大小或 SHA-256 缺失或不一致。");
    }

    private boolean sameHost(Item item, String responseHostId) {
        String response = clean(responseHostId);
        return response.length() > 0 && item.hostId.length() > 0 && item.hostId.equals(response);
    }

    private static boolean generationChanged(String expected, String actual) {
        return clean(expected).length() == 0 || clean(actual).length() == 0 || !clean(expected).equals(clean(actual));
    }

    private String receiptScopeProblem(Item item, ReceiptResult receipt, boolean requireFingerprint) {
        if (receipt == null) return "receipt_missing";
        if (!sameHost(item, receipt.hostId)) return "receipt_host_mismatch";
        if (generationChanged(item.dataGeneration, receipt.dataGeneration)) return "receipt_generation_mismatch";
        if (!item.targetType.equals(receipt.targetType) || !item.targetId.equals(receipt.targetId)
            || !item.studentId.equals(receipt.studentId)) return "receipt_scope_mismatch";
        if (!item.requestId.equals(receipt.receiptId)) return "receipt_identifier_mismatch";
        if (requireFingerprint && (item.size != receipt.size || !item.sha256.equals(receipt.sha256))) {
            return "receipt_fingerprint_mismatch";
        }
        return "";
    }

    private void validateRequest(EnqueueRequest request) throws Exception {
        if (request == null) throw new Exception("upload request is required");
        request.hostBaseUrl = normalizeBaseUrl(request.hostBaseUrl);
        request.targetType = clean(request.targetType).toLowerCase(Locale.ROOT);
        if (request.hostBaseUrl.length() == 0 || clean(request.deviceId).length() == 0
            || clean(request.studentId).length() == 0 || clean(request.targetId).length() == 0
            || clean(request.filename).length() == 0) throw new Exception("upload request scope is incomplete");
        if (!"student".equals(request.targetType) && !"project".equals(request.targetType)) {
            throw new Exception("unsupported upload target type");
        }
        if ("student".equals(request.targetType) && !clean(request.targetId).equals(clean(request.studentId))) {
            throw new Exception("student upload target does not match fixed student");
        }
    }

    private void assertSameScope(Item existing, EnqueueRequest request) throws Exception {
        if (!existing.hostId.equals(clean(request.hostId))
            || !existing.hostBaseUrl.equals(normalizeBaseUrl(request.hostBaseUrl))
            || !existing.dataGeneration.equals(clean(request.dataGeneration))
            || !existing.deviceId.equals(clean(request.deviceId))
            || !existing.studentId.equals(clean(request.studentId))
            || !existing.targetType.equals(clean(request.targetType))
            || !existing.targetId.equals(clean(request.targetId))) {
            throw new Exception("upload request id is already bound to another scope");
        }
    }

    private Properties toProperties(Item item) {
        Properties value = new Properties();
        value.setProperty("formatVersion", FORMAT_VERSION);
        value.setProperty("requestId", item.requestId);
        value.setProperty("hostId", item.hostId);
        value.setProperty("hostBaseUrl", item.hostBaseUrl);
        value.setProperty("dataGeneration", item.dataGeneration);
        value.setProperty("deviceId", item.deviceId);
        value.setProperty("studentId", item.studentId);
        value.setProperty("targetType", item.targetType);
        value.setProperty("targetId", item.targetId);
        value.setProperty("targetName", item.targetName);
        value.setProperty("filename", item.filename);
        value.setProperty("sourceType", item.sourceType);
        value.setProperty("extraQuery", item.extraQuery);
        value.setProperty("payloadName", item.payloadName);
        value.setProperty("size", String.valueOf(item.size));
        value.setProperty("sha256", item.sha256);
        value.setProperty("createdAt", String.valueOf(item.createdAt));
        value.setProperty("state", item.state);
        value.setProperty("attempts", String.valueOf(item.attempts));
        value.setProperty("updatedAt", String.valueOf(item.updatedAt));
        value.setProperty("lastCode", item.lastCode);
        value.setProperty("lastMessage", item.lastMessage);
        value.setProperty("receiptHostId", item.receiptHostId);
        value.setProperty("receiptGeneration", item.receiptGeneration);
        value.setProperty("materialId", item.materialId);
        value.setProperty("materialVersion", String.valueOf(item.materialVersion));
        value.setProperty("legacyReceipt", String.valueOf(item.legacyReceipt));
        return value;
    }

    private Item read(File record) throws Exception {
        Properties value = new Properties();
        InputStream input = new BufferedInputStream(new FileInputStream(record));
        try { value.load(input); } finally { input.close(); }
        Item item = new Item(value);
        boolean unscopedManualRecord = STATE_RECEIPT_UNKNOWN.equals(item.state)
            && "host_scope_missing".equals(item.lastCode)
            && (item.hostId.length() == 0 || item.dataGeneration.length() == 0);
        if (!FORMAT_VERSION.equals(value.getProperty("formatVersion")) || !safeId(item.requestId)
            || !record.getName().equals(item.requestId + ".properties") || !safePayloadName(item.payloadName)
            || (!unscopedManualRecord && (item.hostId.length() == 0 || item.dataGeneration.length() == 0))
            || item.hostBaseUrl.length() == 0 || item.deviceId.length() == 0
            || item.sha256.length() != 64 || item.size < 0) {
            throw new Exception("invalid durable upload record: " + record.getName());
        }
        return item;
    }

    private void writeRecord(File target, Properties value) throws Exception {
        File next = new File(target.getParentFile(), target.getName() + ".next");
        File backup = new File(target.getParentFile(), target.getName() + ".bak");
        FileOutputStream fileOutput = new FileOutputStream(next);
        BufferedOutputStream output = new BufferedOutputStream(fileOutput);
        try {
            value.store(output, "AI Education Manager teacher upload queue");
            output.flush();
            fileOutput.getFD().sync();
        } finally {
            output.close();
        }
        if (backup.exists() && !backup.delete()) throw new Exception("cannot clear previous queue backup");
        if (target.exists() && !target.renameTo(backup)) throw new Exception("cannot preserve previous queue record");
        if (!next.renameTo(target)) {
            if (backup.exists()) backup.renameTo(target);
            throw new Exception("cannot publish queue record");
        }
        if (backup.exists()) backup.delete();
    }

    private void recoverSidecars() throws Exception {
        File[] files = recordsDir.listFiles();
        if (files == null) return;
        for (File file : files) {
            String name = file.getName();
            if (name.endsWith(".properties.bak")) {
                File target = new File(recordsDir, name.substring(0, name.length() - 4));
                if (!target.exists() && !file.renameTo(target)) throw new Exception("cannot recover queue backup");
                if (target.exists() && file.exists()) file.delete();
            } else if (name.endsWith(".properties.next")) {
                File target = new File(recordsDir, name.substring(0, name.length() - 5));
                if (!target.exists() && !file.renameTo(target)) throw new Exception("cannot recover queue update");
                if (target.exists() && file.exists()) file.delete();
            }
        }
    }

    private File recordFile(String requestId) {
        return new File(recordsDir, requestId + ".properties");
    }

    private Fingerprint fingerprint(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        InputStream input = new BufferedInputStream(new FileInputStream(file));
        long size = 0L;
        try {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = input.read(buffer)) != -1) {
                size += read;
                digest.update(buffer, 0, read);
            }
        } finally {
            input.close();
        }
        return new Fingerprint(size, hex(digest.digest()));
    }

    private static final class Fingerprint {
        final long size;
        final String sha256;
        Fingerprint(long size, String sha256) { this.size = size; this.sha256 = sha256; }
    }

    private static final class ProcessResult {
        boolean received;
        boolean unknown;
        boolean failed;
        boolean authorizationPaused;
    }

    private static File requireDirectoryRoot(File value) throws Exception {
        if (value == null) throw new Exception("queue root is required");
        ensureDirectory(value);
        return value.getCanonicalFile();
    }

    private static void ensureDirectory(File value) throws Exception {
        if ((!value.exists() && !value.mkdirs()) || !value.isDirectory()) {
            throw new Exception("cannot create upload queue directory");
        }
    }

    private static String newRequestId() {
        return "android-teacher-" + UUID.randomUUID().toString().replace("-", "");
    }

    private static boolean safeId(String value) {
        return value != null && value.length() > 0 && value.length() <= 180
            && value.matches("[A-Za-z0-9._-]+");
    }

    private static boolean safePayloadName(String value) {
        return value != null && value.length() > ".payload".length() && value.length() <= 188
            && value.matches("[A-Za-z0-9._-]+") && value.endsWith(".payload")
            && value.indexOf('/') < 0 && value.indexOf('\\') < 0;
    }

    private static String normalizeBaseUrl(String value) {
        String result = clean(value);
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        return result;
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private static long number(String value, long fallback) {
        try { return Long.parseLong(value == null ? "" : value); }
        catch (Exception ignored) { return fallback; }
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }
}
