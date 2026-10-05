package com.qxmatrix.eduteacher;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

public final class ProjectMaterialUploadQueueHarness {
    private static int assertions = 0;

    public static void main(String[] args) throws Exception {
        File root = Files.createTempDirectory("teacher-material-queue-").toFile();
        try {
            persistenceAndLostReceipt(root);
            partialAndAuthorization(root);
            runtimeScopeStopsOldHostContact(root);
            strictAcknowledgements(root);
            legacyCompatibilityIsManual(root);
            incompleteScopeKeepsStableCopy(root);
            uiScopeRejectsStaleResults();
            System.out.println("teacher queue assertions=" + assertions);
        } finally {
            remove(root);
        }
    }

    private static void persistenceAndLostReceipt(File parent) throws Exception {
        File root = new File(parent, "persistence");
        ProjectMaterialUploadQueue queue = queue(root);
        ProjectMaterialUploadQueue.Item first = enqueue(queue, "req-a", "student-a", "project-a", "generation-1", "alpha");
        equal(first.studentId, "student-a", "student scope is fixed");
        equal(first.targetId, "project-a", "project scope is fixed");
        check(first.sha256.matches("[0-9a-f]{64}"), "content hash is persisted");
        check(queue.payload(first).isFile(), "stable private payload exists");

        queue.process(new BaseTransport() {
            @Override public ProjectMaterialUploadQueue.UploadResult upload(ProjectMaterialUploadQueue.Item item, File payload)
                throws ProjectMaterialUploadQueue.QueueTransportException {
                throw ProjectMaterialUploadQueue.QueueTransportException.unknown("synthetic lost response");
            }
        }, runtime("generation-1"), 10);
        equal(find(queue, "req-a").state, ProjectMaterialUploadQueue.STATE_RECEIPT_UNKNOWN,
            "lost upload response remains unknown");
        check(queue.payload(find(queue, "req-a")).isFile(), "lost response retains stable payload");

        ProjectMaterialUploadQueue reopened = queue(root);
        final int[] retransmits = new int[] {0};
        reopened.process(new BaseTransport() {
            @Override public ProjectMaterialUploadQueue.ReceiptResult queryReceipt(ProjectMaterialUploadQueue.Item item) {
                return receipt(item, ProjectMaterialUploadQueue.RECEIPT_VERIFIED, true, "material-a");
            }
            @Override public ProjectMaterialUploadQueue.UploadResult upload(ProjectMaterialUploadQueue.Item item, File payload) {
                retransmits[0]++;
                return success(item);
            }
        }, runtime("generation-1"), 10);
        equal(retransmits[0], 0, "verified lost receipt is not retransmitted");
        equal(find(reopened, "req-a").state, ProjectMaterialUploadQueue.STATE_RECEIVED,
            "verified receipt settles persisted item");
        equal(find(reopened, "req-a").materialId, "material-a", "material receipt is persisted");
        check(!reopened.payload(find(reopened, "req-a")).exists(), "payload is removed only after strict verification");
    }

    private static void partialAndAuthorization(File parent) throws Exception {
        File root = new File(parent, "partial");
        ProjectMaterialUploadQueue queue = queue(root);
        enqueue(queue, "req-1", "student-a", "project-a", "generation-1", "one");
        enqueue(queue, "req-2", "student-b", "project-b", "generation-1", "two");
        enqueue(queue, "req-3", "student-c", "project-c", "generation-1", "three");
        ProjectMaterialUploadQueue.BatchResult result = queue.process(new BaseTransport() {
            @Override public ProjectMaterialUploadQueue.UploadResult upload(ProjectMaterialUploadQueue.Item item, File payload)
                throws ProjectMaterialUploadQueue.QueueTransportException {
                if ("req-1".equals(item.requestId)) return success(item);
                if ("req-2".equals(item.requestId)) {
                    throw ProjectMaterialUploadQueue.QueueTransportException.unknown("response lost");
                }
                throw ProjectMaterialUploadQueue.QueueTransportException.auth("device authorization revoked");
            }
        }, runtime("generation-1"), 10);
        equal(result.received, 1, "partial batch keeps successful item");
        equal(result.unknown, 1, "partial batch keeps unknown item separately");
        equal(result.pausedAuthorization, 1, "authorization failure is reported separately");
        check(result.stoppedForAuthorization, "authorization failure stops later automatic sends");
        equal(find(queue, "req-1").state, ProjectMaterialUploadQueue.STATE_RECEIVED, "first item is settled");
        equal(find(queue, "req-2").state, ProjectMaterialUploadQueue.STATE_RECEIPT_UNKNOWN, "second item stays unknown");
        equal(find(queue, "req-3").state, ProjectMaterialUploadQueue.STATE_PAUSED_AUTH, "third item pauses for auth");

        equal(queue.resumeAuthorization("", "device-1"), 0, "empty host never matches an authorization scope");
        equal(queue.resumeAuthorization("other-host", "device-1"), 0, "another host cannot resume queue");
        equal(queue.resumeAuthorization("host-1", "device-1"), 1, "same non-empty host and device can resume authorization");
        equal(find(queue, "req-3").studentId, "student-c", "resume does not use a newly selected student");
    }

    private static void runtimeScopeStopsOldHostContact(File parent) throws Exception {
        ProjectMaterialUploadQueue queue = queue(new File(parent, "runtime-boundary"));
        enqueue(queue, "req-runtime", "student-a", "project-a", "generation-old", "old");
        final int[] networkCalls = new int[] {0};
        queue.process(new BaseTransport() {
            @Override public ProjectMaterialUploadQueue.ReceiptResult queryReceipt(ProjectMaterialUploadQueue.Item item) {
                networkCalls[0]++;
                return notFound(item);
            }
            @Override public ProjectMaterialUploadQueue.UploadResult upload(ProjectMaterialUploadQueue.Item item, File payload) {
                networkCalls[0]++;
                return success(item);
            }
        }, runtime("generation-restored"), 10);
        equal(networkCalls[0], 0, "runtime generation mismatch is stopped before receipt or upload network calls");
        equal(find(queue, "req-runtime").state, ProjectMaterialUploadQueue.STATE_RECEIPT_UNKNOWN,
            "runtime mismatch remains visible for manual review");
        check(queue.payload(find(queue, "req-runtime")).isFile(), "runtime mismatch retains stable payload");
    }

    private static void strictAcknowledgements(File parent) throws Exception {
        ProjectMaterialUploadQueue missingReceiptRoot = queue(new File(parent, "missing-upload-receipt"));
        enqueue(missingReceiptRoot, "req-missing-host", "student-a", "project-a", "generation-1", "body");
        missingReceiptRoot.process(new BaseTransport() {
            @Override public ProjectMaterialUploadQueue.UploadResult upload(ProjectMaterialUploadQueue.Item item, File payload) {
                return new ProjectMaterialUploadQueue.UploadResult(
                    ProjectMaterialUploadQueue.RECEIPT_VERIFIED, "", item.dataGeneration,
                    item.targetType, item.targetId, item.studentId, item.requestId,
                    item.size, item.sha256, "material-a", 1, false);
            }
        }, runtime("generation-1"), 10);
        ProjectMaterialUploadQueue.Item missingHost = find(missingReceiptRoot, "req-missing-host");
        equal(missingHost.state, ProjectMaterialUploadQueue.STATE_RECEIPT_UNKNOWN,
            "2xx-style upload result missing host identity is not received");
        check(missingReceiptRoot.payload(missingHost).isFile(), "unverified upload result retains stable copy");

        ProjectMaterialUploadQueue badQueryRoot = queue(new File(parent, "bad-query-receipt"));
        enqueue(badQueryRoot, "req-bad-query", "student-a", "project-a", "generation-1", "body");
        final int[] uploads = new int[] {0};
        badQueryRoot.process(new BaseTransport() {
            @Override public ProjectMaterialUploadQueue.ReceiptResult queryReceipt(ProjectMaterialUploadQueue.Item item) {
                return new ProjectMaterialUploadQueue.ReceiptResult(
                    ProjectMaterialUploadQueue.RECEIPT_VERIFIED, item.hostId, item.dataGeneration,
                    item.targetType, item.targetId, "", item.requestId,
                    item.size, item.sha256, "material-a", 1);
            }
            @Override public ProjectMaterialUploadQueue.UploadResult upload(ProjectMaterialUploadQueue.Item item, File payload) {
                uploads[0]++;
                return success(item);
            }
        }, runtime("generation-1"), 10);
        equal(uploads[0], 0, "receipt missing student scope never authorizes upload or settlement");
        equal(find(badQueryRoot, "req-bad-query").state, ProjectMaterialUploadQueue.STATE_RECEIPT_UNKNOWN,
            "incomplete verified receipt remains unknown");
    }

    private static void legacyCompatibilityIsManual(File parent) throws Exception {
        File root = new File(parent, "legacy");
        ProjectMaterialUploadQueue queue = queue(root);
        enqueue(queue, "req-legacy", "student-a", "project-a", "generation-1", "legacy");
        queue.process(new BaseTransport() {
            @Override public ProjectMaterialUploadQueue.ReceiptResult queryReceipt(ProjectMaterialUploadQueue.Item item)
                throws ProjectMaterialUploadQueue.QueueTransportException {
                throw ProjectMaterialUploadQueue.QueueTransportException.receiptUnsupported("old host");
            }
            @Override public ProjectMaterialUploadQueue.UploadResult upload(ProjectMaterialUploadQueue.Item item, File payload) {
                return new ProjectMaterialUploadQueue.UploadResult(
                    "", "", "", "", "", "", "", -1L, "", "", 0, true);
            }
        }, runtime("generation-1"), 10);
        ProjectMaterialUploadQueue.Item legacy = find(queue, "req-legacy");
        equal(legacy.state, ProjectMaterialUploadQueue.STATE_RECEIPT_UNKNOWN,
            "old-host 2xx without verifiable receipt is explicitly pending manual review");
        check(queue.payload(legacy).isFile(), "old-host result retains stable copy");

        final int[] blindRetry = new int[] {0};
        queue.process(new BaseTransport() {
            @Override public ProjectMaterialUploadQueue.ReceiptResult queryReceipt(ProjectMaterialUploadQueue.Item item)
                throws ProjectMaterialUploadQueue.QueueTransportException {
                throw ProjectMaterialUploadQueue.QueueTransportException.receiptUnsupported("old host");
            }
            @Override public ProjectMaterialUploadQueue.UploadResult upload(ProjectMaterialUploadQueue.Item item, File payload) {
                blindRetry[0]++;
                return success(item);
            }
        }, runtime("generation-1"), 10);
        equal(blindRetry[0], 0, "unsupported receipt query never blindly retransmits an unknown item");
        equal(find(queue, "req-legacy").state, ProjectMaterialUploadQueue.STATE_RECEIPT_UNKNOWN,
            "unsupported receipt item remains visible for review");
    }

    private static void incompleteScopeKeepsStableCopy(File parent) throws Exception {
        ProjectMaterialUploadQueue queue = queue(new File(parent, "incomplete-scope"));
        ProjectMaterialUploadQueue.EnqueueRequest request = new ProjectMaterialUploadQueue.EnqueueRequest();
        request.hostId = "";
        request.hostBaseUrl = "http://127.0.0.1:18777";
        request.dataGeneration = "";
        request.deviceId = "device-1";
        request.studentId = "student-a";
        request.targetType = "project";
        request.targetId = "project-a";
        request.filename = "missing-scope.txt";
        ProjectMaterialUploadQueue.Item item = queue.enqueue(request, bytes("scope"));
        equal(item.state, ProjectMaterialUploadQueue.STATE_RECEIPT_UNKNOWN,
            "missing host scope creates a manual-review record, not an auto-send record");
        equal(item.lastCode, "host_scope_missing", "missing scope is explicit");
        check(queue.payload(item).isFile(), "missing scope still owns a stable private payload");
        final int[] networkCalls = new int[] {0};
        ProjectMaterialUploadQueue.BatchResult result = queue.process(new BaseTransport() {
            @Override public ProjectMaterialUploadQueue.ReceiptResult queryReceipt(ProjectMaterialUploadQueue.Item queued) {
                networkCalls[0]++;
                return notFound(queued);
            }
            @Override public ProjectMaterialUploadQueue.UploadResult upload(ProjectMaterialUploadQueue.Item queued, File payload) {
                networkCalls[0]++;
                return success(queued);
            }
        }, runtime("generation-1"), 10);
        equal(networkCalls[0], 0, "missing host scope never reaches network transport");
        equal(result.unknown, 1, "missing host scope remains in manual-review count");
    }

    private static void uiScopeRejectsStaleResults() {
        ProjectMaterialUploadQueue.UiScope scope = new ProjectMaterialUploadQueue.UiScope(
            7L, "student-a", "project", "project-a", "http://127.0.0.1:18777", "credential-a");
        check(scope.matches(7L, "student-a", "project", "project-a",
            "http://127.0.0.1:18777", "credential-a", "", ""),
            "unbound UI scope matches only its original local selection");
        scope.bindRuntime(runtime("generation-1"));
        check(scope.matches(7L, "student-a", "project", "project-a",
            "http://127.0.0.1:18777", "credential-a", "host-1", "generation-1"),
            "verified runtime remains bound to the original page scope");
        check(!scope.matches(8L, "student-a", "project", "project-a",
            "http://127.0.0.1:18777", "credential-a", "host-1", "generation-1"),
            "selection generation change rejects an old result");
        check(!scope.matches(7L, "student-b", "project", "project-a",
            "http://127.0.0.1:18777", "credential-a", "host-1", "generation-1"),
            "student switch rejects an old result");
        check(!scope.matches(7L, "student-a", "project", "project-b",
            "http://127.0.0.1:18777", "credential-a", "host-1", "generation-1"),
            "project switch rejects an old result");
        check(!scope.matches(7L, "student-a", "project", "project-a",
            "http://127.0.0.1:18778", "credential-a", "host-1", "generation-1"),
            "host address switch rejects an old result");
        check(!scope.matches(7L, "student-a", "project", "project-a",
            "http://127.0.0.1:18777", "credential-b", "host-1", "generation-1"),
            "credential switch rejects an old result");
        check(!scope.matches(7L, "student-a", "project", "project-a",
            "http://127.0.0.1:18777", "credential-a", "host-1", "generation-2"),
            "host data generation switch rejects an old result");
    }

    private static ProjectMaterialUploadQueue queue(File root) throws Exception {
        return new ProjectMaterialUploadQueue(root, 1024 * 1024);
    }

    private static ProjectMaterialUploadQueue.RuntimeScope runtime(String generation) {
        return new ProjectMaterialUploadQueue.RuntimeScope(
            "host-1", generation, "device-1", "http://127.0.0.1:18777", true);
    }

    private static ProjectMaterialUploadQueue.Item enqueue(ProjectMaterialUploadQueue queue, String requestId,
                                                            String studentId, String projectId,
                                                            String generation, String text) throws Exception {
        ProjectMaterialUploadQueue.EnqueueRequest request = new ProjectMaterialUploadQueue.EnqueueRequest();
        request.requestId = requestId;
        request.hostId = "host-1";
        request.hostBaseUrl = "http://127.0.0.1:18777";
        request.dataGeneration = generation;
        request.deviceId = "device-1";
        request.studentId = studentId;
        request.targetType = "project";
        request.targetId = projectId;
        request.targetName = projectId;
        request.filename = requestId + ".txt";
        request.sourceType = "android_teacher_terminal_file";
        return queue.enqueue(request, bytes(text));
    }

    private static ProjectMaterialUploadQueue.Source bytes(String text) {
        final byte[] value = text.getBytes(StandardCharsets.UTF_8);
        return new ProjectMaterialUploadQueue.Source() {
            @Override public InputStream open() { return new ByteArrayInputStream(value); }
        };
    }

    private static ProjectMaterialUploadQueue.Item find(ProjectMaterialUploadQueue queue, String requestId) throws Exception {
        List<ProjectMaterialUploadQueue.Item> items = queue.list();
        for (ProjectMaterialUploadQueue.Item item : items) if (requestId.equals(item.requestId)) return item;
        throw new AssertionError("missing queue item " + requestId);
    }

    private static ProjectMaterialUploadQueue.ReceiptResult receipt(ProjectMaterialUploadQueue.Item item,
                                                                     String status, boolean fingerprint,
                                                                     String materialId) {
        return new ProjectMaterialUploadQueue.ReceiptResult(status, item.hostId, item.dataGeneration,
            item.targetType, item.targetId, item.studentId, item.requestId,
            fingerprint ? item.size : -1L, fingerprint ? item.sha256 : "", materialId, 1);
    }

    private static ProjectMaterialUploadQueue.ReceiptResult notFound(ProjectMaterialUploadQueue.Item item) {
        return receipt(item, ProjectMaterialUploadQueue.RECEIPT_NOT_FOUND, false, "");
    }

    private static ProjectMaterialUploadQueue.UploadResult success(ProjectMaterialUploadQueue.Item item) {
        return new ProjectMaterialUploadQueue.UploadResult(ProjectMaterialUploadQueue.RECEIPT_VERIFIED,
            item.hostId, item.dataGeneration, item.targetType, item.targetId, item.studentId,
            item.requestId, item.size, item.sha256, "material-" + item.requestId, 1, false);
    }

    private static class BaseTransport implements ProjectMaterialUploadQueue.Transport {
        @Override public ProjectMaterialUploadQueue.ReceiptResult queryReceipt(ProjectMaterialUploadQueue.Item item)
            throws ProjectMaterialUploadQueue.QueueTransportException {
            return notFound(item);
        }
        @Override public ProjectMaterialUploadQueue.UploadResult upload(ProjectMaterialUploadQueue.Item item, File payload)
            throws ProjectMaterialUploadQueue.QueueTransportException {
            return success(item);
        }
    }

    private static void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }

    private static void equal(Object actual, Object expected, String message) {
        assertions++;
        if (actual == null ? expected != null : !actual.equals(expected)) {
            throw new AssertionError(message + ": expected=" + expected + ", actual=" + actual);
        }
    }

    private static void remove(File value) {
        if (value == null || !value.exists()) return;
        File[] children = value.listFiles();
        if (children != null) for (File child : children) remove(child);
        value.delete();
    }
}
