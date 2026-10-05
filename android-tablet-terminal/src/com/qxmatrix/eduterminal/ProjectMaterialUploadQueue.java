package com.qxmatrix.eduterminal;

import java.io.BufferedInputStream;
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
 * Durable, app-private upload queue for student/project materials.
 *
 * <p>The queue owns a stable copy of every payload before network delivery.
 * The host, device, student, target, request id and content hash are immutable.
 * An interrupted upload is recovered as {@link State#RECEIPT_UNKNOWN}; callers
 * must query the host receipt before the same request may be transmitted again.
 * This class intentionally has no Android dependency so its crash/restart
 * behavior can be exercised on the JVM.</p>
 */
public final class ProjectMaterialUploadQueue {
    /** One process may open the same queue from the Activity and JobService. */
    private static final Object PROCESS_LOCK = new Object();
    public static final long MAX_PAYLOAD_BYTES = 200L * 1024L * 1024L;
    public enum State {
        QUEUED,
        UPLOADING,
        RECEIPT_QUERYING,
        RECEIPT_UNKNOWN,
        RECEIVED,
        PAUSED_PERMISSION,
        PAUSED_RECEIPT,
        FAILED_PERMANENT
    }

    public enum Action {
        NONE,
        UPLOAD,
        QUERY_RECEIPT,
        HOLD_SCOPE,
        HOLD_PERMISSION
    }

    public static final class Metadata {
        public final String hostId;
        public final String dataGeneration;
        public final String deviceId;
        public final String studentId;
        public final String targetType;
        public final String targetId;
        public final String fileName;
        public final String sourceType;
        public final String attributionQuery;
        public final String sourceReference;

        public Metadata(String hostId, String dataGeneration, String deviceId, String studentId,
                        String targetType, String targetId, String fileName, String sourceType) {
            this(hostId, dataGeneration, deviceId, studentId, targetType, targetId, fileName,
                sourceType, "", "");
        }

        public Metadata(String hostId, String dataGeneration, String deviceId, String studentId,
                        String targetType, String targetId, String fileName, String sourceType,
                        String attributionQuery) {
            this(hostId, dataGeneration, deviceId, studentId, targetType, targetId, fileName,
                sourceType, attributionQuery, "");
        }

        public Metadata(String hostId, String dataGeneration, String deviceId, String studentId,
                        String targetType, String targetId, String fileName, String sourceType,
                        String attributionQuery, String sourceReference) {
            this.hostId = required(hostId, "hostId");
            this.dataGeneration = required(dataGeneration, "dataGeneration");
            this.deviceId = required(deviceId, "deviceId");
            this.studentId = required(studentId, "studentId");
            this.targetType = required(targetType, "targetType");
            this.targetId = required(targetId, "targetId");
            this.fileName = required(fileName, "fileName");
            this.sourceType = required(sourceType, "sourceType");
            this.attributionQuery = clean(attributionQuery);
            this.sourceReference = clean(sourceReference);
            if (!"student".equals(this.targetType) && !"project".equals(this.targetType)) {
                throw new IllegalArgumentException("targetType must be student or project");
            }
            if ("student".equals(this.targetType) && !this.studentId.equals(this.targetId)) {
                throw new IllegalArgumentException("student target must match studentId");
            }
        }
    }

    public static final class RuntimeScope {
        public final String hostId;
        public final String dataGeneration;
        public final String deviceId;
        public final String studentId;
        public final boolean credentialAvailable;

        public RuntimeScope(String hostId, String dataGeneration, String deviceId, String studentId,
                            boolean credentialAvailable) {
            this.hostId = clean(hostId);
            this.dataGeneration = clean(dataGeneration);
            this.deviceId = clean(deviceId);
            this.studentId = clean(studentId);
            this.credentialAvailable = credentialAvailable;
        }
    }

    public static final class Entry {
        public final String requestId;
        public final String hostId;
        public final String dataGeneration;
        public final String deviceId;
        public final String studentId;
        public final String targetType;
        public final String targetId;
        public final String fileName;
        public final String sourceType;
        public final String attributionQuery;
        public final String sourceReference;
        public final String contentSha256;
        public final long byteSize;
        public final String payloadPath;
        public final long createdAt;
        public State state;
        public int attempts;
        public long updatedAt;
        public String lastError;
        public String receiptStatus;

        private Entry(String requestId, Metadata metadata, String contentSha256, long byteSize,
                      String payloadPath, long createdAt) {
            this(requestId, metadata.hostId, metadata.dataGeneration, metadata.deviceId,
                metadata.studentId, metadata.targetType, metadata.targetId, metadata.fileName,
                metadata.sourceType, metadata.attributionQuery, metadata.sourceReference,
                contentSha256, byteSize, payloadPath, createdAt,
                State.QUEUED, 0, createdAt, "", "");
        }

        private Entry(String requestId, String hostId, String dataGeneration, String deviceId,
                      String studentId, String targetType, String targetId, String fileName,
                      String sourceType, String attributionQuery, String sourceReference,
                      String contentSha256, long byteSize, String payloadPath,
                      long createdAt, State state, int attempts, long updatedAt, String lastError,
                      String receiptStatus) {
            this.requestId = requestId;
            this.hostId = hostId;
            this.dataGeneration = dataGeneration;
            this.deviceId = deviceId;
            this.studentId = studentId;
            this.targetType = targetType;
            this.targetId = targetId;
            this.fileName = fileName;
            this.sourceType = sourceType;
            this.attributionQuery = attributionQuery;
            this.sourceReference = sourceReference;
            this.contentSha256 = contentSha256;
            this.byteSize = byteSize;
            this.payloadPath = payloadPath;
            this.createdAt = createdAt;
            this.state = state;
            this.attempts = attempts;
            this.updatedAt = updatedAt;
            this.lastError = lastError;
            this.receiptStatus = receiptStatus;
        }

        public File payloadFile() { return new File(payloadPath); }
        public boolean isFinished() { return state == State.RECEIVED || state == State.FAILED_PERMANENT; }
    }

    private final File root;
    private final File payloadDir;
    private final File itemDir;
    private final File stagingDir;

    public ProjectMaterialUploadQueue(File root) throws Exception {
        if (root == null) throw new IllegalArgumentException("queue root is required");
        this.root = root.getCanonicalFile();
        this.payloadDir = new File(this.root, "payloads");
        this.itemDir = new File(this.root, "items");
        this.stagingDir = new File(this.root, "staging");
        ensureDirectory(this.root);
        ensureDirectory(this.payloadDir);
        ensureDirectory(this.itemDir);
        ensureDirectory(this.stagingDir);
        synchronized (PROCESS_LOCK) { recoverAtomicMetadataArtifacts(); }
    }

    public synchronized Entry enqueue(InputStream source, Metadata metadata) throws Exception {
        synchronized (PROCESS_LOCK) {
        if (source == null) throw new IllegalArgumentException("source is required");
        if (metadata == null) throw new IllegalArgumentException("metadata is required");
        String nonce = UUID.randomUUID().toString();
        File temporary = new File(stagingDir, nonce + ".partial");
        long bytes = 0L;
        String contentHash;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            OutputStream output = new FileOutputStream(temporary, false);
            try {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = source.read(buffer)) != -1) {
                    if (read == 0) continue;
                    output.write(buffer, 0, read);
                    digest.update(buffer, 0, read);
                    bytes += read;
                    if (bytes > MAX_PAYLOAD_BYTES) throw new Exception("material exceeds private queue limit");
                }
                output.flush();
                if (output instanceof FileOutputStream) ((FileOutputStream) output).getFD().sync();
            } finally {
                output.close();
            }
            contentHash = hex(digest.digest());
            String requestSeed = metadata.hostId + "\n" + metadata.deviceId + "\n"
                + metadata.studentId + "\n" + metadata.targetType + "\n" + metadata.targetId
                + "\n" + contentHash + "\n" + nonce;
            String requestId = "android-material-" + sha256Text(requestSeed).substring(0, 32);
            File payload = new File(payloadDir, requestId + ".bin");
            if (!temporary.renameTo(payload)) throw new Exception("cannot publish stable private payload");
            long now = System.currentTimeMillis();
            Entry entry = new Entry(requestId, metadata, contentHash, bytes,
                payload.getCanonicalPath(), now);
            try {
                persist(entry);
            } catch (Exception error) {
                payload.delete();
                throw error;
            }
            return entry;
        } finally {
            if (temporary.exists()) temporary.delete();
        }
        }
    }

    /** Converts crash-interrupted network work to receipt-first recovery. */
    public synchronized List<Entry> recoverInterrupted() throws Exception {
        synchronized (PROCESS_LOCK) {
        List<Entry> entries = list();
        for (Entry entry : entries) {
            if (entry.state == State.UPLOADING || entry.state == State.RECEIPT_QUERYING) {
                entry.state = State.RECEIPT_UNKNOWN;
                entry.lastError = "app_restarted_after_uncertain_delivery";
                touchAndPersist(entry);
            } else if (entry.state == State.RECEIVED) {
                if (entry.payloadFile().isFile()) entry.payloadFile().delete();
            } else if (!inside(payloadDir, entry.payloadFile()) || !entry.payloadFile().isFile()) {
                if (!entry.isFinished()) {
                    entry.state = State.PAUSED_PERMISSION;
                    entry.lastError = "stable_private_payload_unavailable";
                    touchAndPersist(entry);
                }
            }
        }
        return list();
        }
    }

    public synchronized List<Entry> list() throws Exception {
        synchronized (PROCESS_LOCK) {
        ArrayList<Entry> result = new ArrayList<Entry>();
        File[] files = itemDir.listFiles();
        if (files != null) {
            for (File file : files) {
                if (!file.isFile() || !file.getName().endsWith(".properties")) continue;
                result.add(read(file));
            }
        }
        Collections.sort(result, new Comparator<Entry>() {
            @Override public int compare(Entry left, Entry right) {
                if (left.createdAt == right.createdAt) return left.requestId.compareTo(right.requestId);
                return left.createdAt < right.createdAt ? -1 : 1;
            }
        });
        return result;
        }
    }

    public synchronized Entry get(String requestId) throws Exception {
        synchronized (PROCESS_LOCK) {
        File file = itemFile(requestId);
        return file.isFile() ? read(file) : null;
        }
    }

    public synchronized Action nextAction(Entry entry, RuntimeScope scope) {
        synchronized (PROCESS_LOCK) {
        if (entry == null || entry.state == State.RECEIVED || entry.state == State.FAILED_PERMANENT
            || entry.state == State.PAUSED_RECEIPT) return Action.NONE;
        if (entry.state == State.PAUSED_PERMISSION || scope == null || !scope.credentialAvailable) {
            return Action.HOLD_PERMISSION;
        }
        if (!entry.hostId.equals(scope.hostId) || !entry.deviceId.equals(scope.deviceId)
            || !entry.studentId.equals(scope.studentId)) {
            return Action.HOLD_SCOPE;
        }
        if (scope.dataGeneration.length() == 0) return Action.HOLD_SCOPE;
        if (!entry.dataGeneration.equals(scope.dataGeneration)) return Action.QUERY_RECEIPT;
        if (entry.state == State.RECEIPT_UNKNOWN || entry.state == State.UPLOADING
            || entry.state == State.RECEIPT_QUERYING) return Action.QUERY_RECEIPT;
        return entry.state == State.QUEUED ? Action.UPLOAD : Action.NONE;
        }
    }

    public synchronized boolean verifyPayload(Entry entry) throws Exception {
        synchronized (PROCESS_LOCK) {
        if (entry == null || !inside(payloadDir, entry.payloadFile()) || !entry.payloadFile().isFile()
            || entry.payloadFile().length() != entry.byteSize) return false;
        return entry.contentSha256.equals(sha256File(entry.payloadFile()));
        }
    }

    public synchronized Entry markUploading(String requestId) throws Exception {
        synchronized (PROCESS_LOCK) {
        Entry entry = requireEntry(requestId);
        if (entry.state != State.QUEUED) throw new IllegalStateException("entry is not ready to upload");
        if (!verifyPayload(entry)) {
            entry.state = State.PAUSED_PERMISSION;
            entry.lastError = "stable_private_payload_unavailable_or_changed";
            touchAndPersist(entry);
            return entry;
        }
        entry.state = State.UPLOADING;
        entry.attempts += 1;
        entry.lastError = "";
        touchAndPersist(entry);
        return entry;
        }
    }

    public synchronized Entry markReceiptQuerying(String requestId) throws Exception {
        synchronized (PROCESS_LOCK) {
        Entry entry = requireEntry(requestId);
        if (entry.state == State.RECEIVED || entry.state == State.FAILED_PERMANENT
            || entry.state == State.PAUSED_RECEIPT) return entry;
        entry.state = State.RECEIPT_QUERYING;
        touchAndPersist(entry);
        return entry;
        }
    }

    public synchronized Entry markTransportUncertain(String requestId, String error) throws Exception {
        synchronized (PROCESS_LOCK) {
        Entry entry = requireEntry(requestId);
        if (entry.state == State.RECEIVED || entry.state == State.FAILED_PERMANENT
            || entry.state == State.PAUSED_RECEIPT) return entry;
        entry.state = State.RECEIPT_UNKNOWN;
        entry.lastError = clean(error);
        touchAndPersist(entry);
        return entry;
        }
    }

    public synchronized Entry applyReceipt(String requestId, String status, String receiptSha256,
                                           String returnedGeneration) throws Exception {
        synchronized (PROCESS_LOCK) {
        Entry entry = requireEntry(requestId);
        if (entry.state == State.RECEIVED || entry.state == State.FAILED_PERMANENT) return entry;
        String normalized = clean(status).toLowerCase(Locale.ROOT);
        String generation = clean(returnedGeneration);
        entry.receiptStatus = normalized;
        if (generation.length() == 0) {
            entry.state = State.PAUSED_RECEIPT;
            entry.lastError = "receipt_data_generation_missing";
        } else if (!entry.dataGeneration.equals(generation)) {
            entry.state = State.PAUSED_RECEIPT;
            entry.lastError = "host_data_generation_changed";
        } else if ("received_verified".equals(normalized)) {
            if (!entry.contentSha256.equals(clean(receiptSha256).toLowerCase(Locale.ROOT))) {
                entry.state = State.PAUSED_RECEIPT;
                entry.lastError = "receipt_content_hash_mismatch";
            } else {
                entry.state = State.RECEIVED;
                entry.lastError = "";
            }
        } else if ("not_found".equals(normalized)) {
            entry.state = State.QUEUED;
            entry.lastError = "receipt_not_found_retransmit_allowed";
        } else if ("received_unavailable".equals(normalized) || "scope_unverifiable".equals(normalized)) {
            entry.state = State.PAUSED_RECEIPT;
            entry.lastError = normalized;
        } else {
            entry.state = State.RECEIPT_UNKNOWN;
            entry.lastError = normalized.length() == 0 ? "receipt_status_unknown" : normalized;
        }
        touchAndPersist(entry);
        if (entry.state == State.RECEIVED && entry.payloadFile().isFile()) entry.payloadFile().delete();
        return entry;
        }
    }

    public synchronized Entry pausePermission(String requestId, String error) throws Exception {
        synchronized (PROCESS_LOCK) {
        Entry entry = requireEntry(requestId);
        entry.state = State.PAUSED_PERMISSION;
        entry.lastError = clean(error);
        touchAndPersist(entry);
        return entry;
        }
    }

    /** Permission recovery is receipt-first because a previous transport may have completed. */
    public synchronized Entry resumePermission(String requestId) throws Exception {
        synchronized (PROCESS_LOCK) {
        Entry entry = requireEntry(requestId);
        if (entry.state != State.PAUSED_PERMISSION) return entry;
        if (!verifyPayload(entry)) return entry;
        entry.state = State.RECEIPT_UNKNOWN;
        entry.lastError = "permission_restored_receipt_check_required";
        touchAndPersist(entry);
        return entry;
        }
    }

    public synchronized Entry failPermanent(String requestId, String error) throws Exception {
        synchronized (PROCESS_LOCK) {
        Entry entry = requireEntry(requestId);
        entry.state = State.FAILED_PERMANENT;
        entry.lastError = clean(error);
        touchAndPersist(entry);
        return entry;
        }
    }

    private Entry requireEntry(String requestId) throws Exception {
        Entry entry = get(requestId);
        if (entry == null) throw new IllegalArgumentException("queue entry not found");
        return entry;
    }

    private void touchAndPersist(Entry entry) throws Exception {
        entry.updatedAt = System.currentTimeMillis();
        persist(entry);
    }

    private void persist(Entry entry) throws Exception {
        Properties values = new Properties();
        values.setProperty("schema", "edu-manager.android-project-material-queue.v1");
        values.setProperty("requestId", entry.requestId);
        values.setProperty("hostId", entry.hostId);
        values.setProperty("dataGeneration", entry.dataGeneration);
        values.setProperty("deviceId", entry.deviceId);
        values.setProperty("studentId", entry.studentId);
        values.setProperty("targetType", entry.targetType);
        values.setProperty("targetId", entry.targetId);
        values.setProperty("fileName", entry.fileName);
        values.setProperty("sourceType", entry.sourceType);
        values.setProperty("attributionQuery", entry.attributionQuery);
        values.setProperty("sourceReference", entry.sourceReference);
        values.setProperty("contentSha256", entry.contentSha256);
        values.setProperty("byteSize", String.valueOf(entry.byteSize));
        values.setProperty("payloadPath", entry.payloadPath);
        values.setProperty("createdAt", String.valueOf(entry.createdAt));
        values.setProperty("state", entry.state.name());
        values.setProperty("attempts", String.valueOf(entry.attempts));
        values.setProperty("updatedAt", String.valueOf(entry.updatedAt));
        values.setProperty("lastError", clean(entry.lastError));
        values.setProperty("receiptStatus", clean(entry.receiptStatus));
        writePropertiesAtomic(itemFile(entry.requestId), values);
    }

    /** Repairs only the queue writer's own atomic temp/backup artifacts. */
    private void recoverAtomicMetadataArtifacts() throws Exception {
        File[] files = itemDir.listFiles();
        if (files == null) return;
        for (File temporary : files) {
            if (!temporary.isFile() || !temporary.getName().endsWith(".properties.tmp")) continue;
            File target = new File(itemDir, temporary.getName().substring(0,
                temporary.getName().length() - ".tmp".length()));
            if (target.isFile()) temporary.delete();
            else if (!temporary.renameTo(target)) throw new Exception("cannot recover queue metadata temp");
        }
        files = itemDir.listFiles();
        if (files == null) return;
        for (File backup : files) {
            if (!backup.isFile() || !backup.getName().endsWith(".properties.bak")) continue;
            File target = new File(itemDir, backup.getName().substring(0,
                backup.getName().length() - ".bak".length()));
            if (target.isFile()) backup.delete();
            else if (!backup.renameTo(target)) throw new Exception("cannot recover queue metadata backup");
        }
    }

    private Entry read(File file) throws Exception {
        Properties values = new Properties();
        InputStream input = new BufferedInputStream(new FileInputStream(file));
        try { values.load(input); } finally { input.close(); }
        String requestId = required(values.getProperty("requestId"), "requestId");
        if (!file.equals(itemFile(requestId))) throw new Exception("queue item filename mismatch");
        String payloadPath = required(values.getProperty("payloadPath"), "payloadPath");
        if (!inside(payloadDir, new File(payloadPath))) throw new Exception("queue payload escapes private root");
        return new Entry(requestId,
            required(values.getProperty("hostId"), "hostId"), clean(values.getProperty("dataGeneration")),
            required(values.getProperty("deviceId"), "deviceId"), required(values.getProperty("studentId"), "studentId"),
            required(values.getProperty("targetType"), "targetType"), required(values.getProperty("targetId"), "targetId"),
            required(values.getProperty("fileName"), "fileName"), required(values.getProperty("sourceType"), "sourceType"),
            clean(values.getProperty("attributionQuery")), clean(values.getProperty("sourceReference")),
            required(values.getProperty("contentSha256"), "contentSha256").toLowerCase(Locale.ROOT),
            parseLong(values.getProperty("byteSize"), -1L), new File(payloadPath).getCanonicalPath(),
            parseLong(values.getProperty("createdAt"), 0L), parseState(values.getProperty("state")),
            (int) parseLong(values.getProperty("attempts"), 0L), parseLong(values.getProperty("updatedAt"), 0L),
            clean(values.getProperty("lastError")), clean(values.getProperty("receiptStatus")));
    }

    private File itemFile(String requestId) throws Exception {
        String safe = required(requestId, "requestId");
        if (!safe.matches("[A-Za-z0-9._-]{1,180}")) throw new IllegalArgumentException("invalid requestId");
        File file = new File(itemDir, safe + ".properties").getCanonicalFile();
        if (!inside(itemDir, file)) throw new IllegalArgumentException("requestId escapes queue root");
        return file;
    }

    private static void writePropertiesAtomic(File target, Properties values) throws Exception {
        File temporary = new File(target.getParentFile(), target.getName() + ".tmp");
        File backup = new File(target.getParentFile(), target.getName() + ".bak");
        OutputStream output = new FileOutputStream(temporary, false);
        try {
            values.store(output, "AI Education Manager Android material upload queue");
            output.flush();
            if (output instanceof FileOutputStream) ((FileOutputStream) output).getFD().sync();
        } finally { output.close(); }
        if (backup.exists() && !backup.delete()) throw new Exception("cannot replace queue backup");
        if (target.exists() && !target.renameTo(backup)) throw new Exception("cannot backup queue item");
        if (!temporary.renameTo(target)) {
            if (backup.exists()) backup.renameTo(target);
            throw new Exception("cannot publish queue item");
        }
        if (backup.exists()) backup.delete();
    }

    private static void ensureDirectory(File directory) throws Exception {
        if ((!directory.isDirectory() && !directory.mkdirs()) || !directory.isDirectory()) {
            throw new Exception("cannot create queue directory");
        }
    }

    private static boolean inside(File root, File candidate) throws Exception {
        String rootPath = root.getCanonicalPath();
        String candidatePath = candidate.getCanonicalPath();
        return candidatePath.equals(rootPath) || candidatePath.startsWith(rootPath + File.separator);
    }

    private static State parseState(String value) {
        try { return State.valueOf(clean(value)); }
        catch (Exception ignored) { return State.RECEIPT_UNKNOWN; }
    }

    private static long parseLong(String value, long fallback) {
        try { return Long.parseLong(clean(value)); }
        catch (Exception ignored) { return fallback; }
    }

    private static String sha256File(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        InputStream input = new BufferedInputStream(new FileInputStream(file));
        try {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) if (read > 0) digest.update(buffer, 0, read);
        } finally { input.close(); }
        return hex(digest.digest());
    }

    private static String sha256Text(String value) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes("UTF-8")));
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }

    private static String required(String value, String name) {
        String result = clean(value);
        if (result.length() == 0) throw new IllegalArgumentException(name + " is required");
        return result;
    }

    private static String clean(String value) { return value == null ? "" : value.trim(); }
}
