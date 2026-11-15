package com.qxmatrix.eduterminal;

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
import java.util.Properties;
import java.util.UUID;

/** App-private, student-scoped staging area. Nothing stored here is sent over the network. */
final class StudentCollectionInbox {
    static final long MAX_PAYLOAD_BYTES = 200L * 1024L * 1024L;
    static final String UNASSIGNED_SHARE = "__unassigned_system_share__";
    enum State { READY, QUEUED, UNAVAILABLE }

    static final class Metadata {
        final String studentId;
        final String sourceType;
        final String fileName;
        final String mimeType;
        final String sourceReference;

        Metadata(String studentId, String sourceType, String fileName, String mimeType, String sourceReference) {
            this.studentId = clean(studentId);
            this.sourceType = clean(sourceType);
            this.fileName = safeName(fileName);
            this.mimeType = clean(mimeType).length() == 0 ? "application/octet-stream" : clean(mimeType);
            this.sourceReference = clean(sourceReference);
            if (this.studentId.length() == 0) throw new IllegalArgumentException("studentId is required");
        }
    }

    static final class Entry {
        final String collectionId;
        final Metadata metadata;
        final long size;
        final String sha256;
        final long createdAt;
        final State state;
        final String payloadPath;
        final String uploadRequestId;
        final String lastError;

        Entry(String collectionId, Metadata metadata, long size, String sha256, long createdAt,
              State state, String payloadPath, String uploadRequestId, String lastError) {
            this.collectionId = collectionId;
            this.metadata = metadata;
            this.size = size;
            this.sha256 = sha256;
            this.createdAt = createdAt;
            this.state = state;
            this.payloadPath = payloadPath;
            this.uploadRequestId = uploadRequestId;
            this.lastError = lastError;
        }

        File payloadFile() { return new File(payloadPath); }
    }

    private final File root;
    private final File payloads;
    private final File items;
    private final File staging;

    StudentCollectionInbox(File root) throws Exception {
        this.root = root;
        this.payloads = new File(root, "payloads");
        this.items = new File(root, "items");
        this.staging = new File(root, "staging");
        mkdir(root); mkdir(payloads); mkdir(items); mkdir(staging);
        recover();
    }

    synchronized Entry collect(InputStream input, Metadata metadata) throws Exception {
        if (input == null) throw new IllegalArgumentException("input is required");
        String id = UUID.randomUUID().toString();
        File partial = new File(staging, id + ".partial");
        File payload = new File(payloads, id + "-" + metadata.fileName);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long size = 0L;
        try {
            FileOutputStream output = new FileOutputStream(partial);
            try {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    size += read;
                    if (size > MAX_PAYLOAD_BYTES) throw new IllegalArgumentException("资料超过本机待上传区 200MB 单文件限制");
                    output.write(buffer, 0, read);
                    digest.update(buffer, 0, read);
                }
                output.flush();
                output.getFD().sync();
            } finally {
                output.close();
            }
            String contentSha256 = hex(digest.digest());
            Entry duplicate = findReadyDuplicate(metadata.studentId, metadata.sourceType, size, contentSha256);
            if (duplicate != null) {
                partial.delete();
                return duplicate;
            }
            move(partial, payload);
            Entry entry = new Entry(id, metadata, size, contentSha256, System.currentTimeMillis(),
                State.READY, payload.getCanonicalPath(), "", "");
            write(entry);
            return entry;
        } catch (Exception error) {
            partial.delete();
            payload.delete();
            throw error;
        }
    }

    synchronized List<Entry> list(String studentId) throws Exception {
        return list(studentId, true);
    }

    private List<Entry> list(String studentId, boolean verifyHash) throws Exception {
        ArrayList<Entry> result = new ArrayList<Entry>();
        File[] files = items.listFiles();
        if (files != null) for (File file : files) {
            if (!file.getName().endsWith(".properties")) continue;
            Entry entry = read(file);
            if (!clean(studentId).equals(entry.metadata.studentId)) continue;
            if (entry.state == State.READY && !entry.payloadFile().isFile()) {
                entry = new Entry(entry.collectionId, entry.metadata, entry.size, entry.sha256, entry.createdAt,
                    State.UNAVAILABLE, entry.payloadPath, entry.uploadRequestId, "本机载荷缺失");
                write(entry);
            } else if (entry.state == State.READY && verifyHash && (!entry.sha256.equals(sha256(entry.payloadFile())) || entry.size != entry.payloadFile().length())) {
                entry = new Entry(entry.collectionId, entry.metadata, entry.size, entry.sha256, entry.createdAt,
                    State.UNAVAILABLE, entry.payloadPath, entry.uploadRequestId, "本机载荷哈希或大小不一致");
                write(entry);
            }
            result.add(entry);
        }
        Collections.sort(result, new Comparator<Entry>() {
            @Override public int compare(Entry a, Entry b) { return a.createdAt == b.createdAt ? 0 : (a.createdAt > b.createdAt ? -1 : 1); }
        });
        return result;
    }

    synchronized List<Entry> ready(String studentId) throws Exception {
        ArrayList<Entry> result = new ArrayList<Entry>();
        for (Entry entry : list(studentId)) if (entry.state == State.READY) result.add(entry);
        return result;
    }

    synchronized List<Entry> readyForDisplay(String studentId) throws Exception {
        ArrayList<Entry> result = new ArrayList<Entry>();
        for (Entry entry : list(studentId, false)) if (entry.state == State.READY) result.add(entry);
        return result;
    }

    synchronized List<Entry> listForDisplay(String studentId) throws Exception {
        return list(studentId, false);
    }

    synchronized Entry assignSharedEntry(String collectionId, String studentId) throws Exception {
        String destination = clean(studentId);
        if (destination.length() == 0 || UNASSIGNED_SHARE.equals(destination)) throw new IllegalArgumentException("studentId is required");
        File file = record(collectionId);
        if (!file.isFile()) throw new IllegalStateException("分享资料已变化，请刷新");
        Entry entry = read(file);
        if (!UNASSIGNED_SHARE.equals(entry.metadata.studentId) || !"android_system_share".equals(entry.metadata.sourceType)
            || entry.state != State.READY || !entry.payloadFile().isFile()
            || entry.size != entry.payloadFile().length() || !entry.sha256.equals(sha256(entry.payloadFile()))) {
            throw new IllegalStateException("分享资料已变化或不可用，请刷新");
        }
        Metadata metadata = new Metadata(destination, entry.metadata.sourceType, entry.metadata.fileName,
            entry.metadata.mimeType, entry.metadata.sourceReference);
        Entry assigned = new Entry(entry.collectionId, metadata, entry.size, entry.sha256, entry.createdAt,
            entry.state, entry.payloadPath, entry.uploadRequestId, entry.lastError);
        write(assigned);
        return assigned;
    }

    synchronized boolean remove(String collectionId, String studentId) throws Exception {
        File record = record(collectionId);
        if (!record.isFile()) return false;
        Entry entry = read(record);
        if (!clean(studentId).equals(entry.metadata.studentId)) return false;
        if (entry.state == State.READY) entry.payloadFile().delete();
        return record.delete();
    }

    synchronized boolean markQueuedByPayloadPath(String path, String uploadRequestId) throws Exception {
        return markQueuedByPayloadPath(path, uploadRequestId, false);
    }

    synchronized boolean markQueuedByPayloadPath(String path, String uploadRequestId, boolean retainPayload) throws Exception {
        String canonical = new File(path).getCanonicalPath();
        File[] files = items.listFiles();
        if (files == null) return false;
        for (File file : files) {
            if (!file.getName().endsWith(".properties")) continue;
            Entry entry = read(file);
            if (entry.state != State.READY || !entry.payloadFile().getCanonicalPath().equals(canonical)) continue;
            if (!entry.payloadFile().isFile() || entry.size != entry.payloadFile().length() || !entry.sha256.equals(sha256(entry.payloadFile()))) {
                Entry unavailable = new Entry(entry.collectionId, entry.metadata, entry.size, entry.sha256, entry.createdAt,
                    State.UNAVAILABLE, entry.payloadPath, "", "交接前载荷复核失败");
                write(unavailable);
                return false;
            }
            Entry queued = new Entry(entry.collectionId, entry.metadata, entry.size, entry.sha256, entry.createdAt,
                State.QUEUED, entry.payloadPath, clean(uploadRequestId), "");
            write(queued);
            if (!retainPayload) entry.payloadFile().delete();
            return true;
        }
        return false;
    }

    synchronized boolean completeQueued(String collectionId, String studentId, String uploadRequestId) throws Exception {
        File file = record(collectionId);
        if (!file.isFile()) return false;
        Entry entry = read(file);
        if (entry.state != State.QUEUED || !entry.metadata.studentId.equals(clean(studentId))
            || entry.uploadRequestId.length() == 0 || !entry.uploadRequestId.equals(clean(uploadRequestId))) return false;
        if (entry.payloadFile().exists() && !entry.payloadFile().delete()) return false;
        return file.delete();
    }

    private void recover() {
        File[] temp = staging.listFiles();
        long staleBefore = System.currentTimeMillis() - 10L * 60L * 1000L;
        if (temp != null) for (File file : temp)
            if (file.getName().endsWith(".partial") && file.lastModified() < staleBefore) file.delete();
    }

    synchronized Entry findByPayloadPath(String studentId, String path) throws Exception {
        String canonical = new File(path).getCanonicalPath();
        for (Entry entry : list(studentId, false)) {
            if (entry.state == State.READY && entry.payloadFile().getCanonicalPath().equals(canonical)) return entry;
        }
        return null;
    }

    private Entry findReadyDuplicate(String studentId, String sourceType, long size, String contentSha256) throws Exception {
        File[] files = items.listFiles();
        if (files == null) return null;
        for (File file : files) {
            if (!file.getName().endsWith(".properties")) continue;
            Entry entry = read(file);
            if (entry.state != State.READY
                || !clean(studentId).equals(entry.metadata.studentId)
                || ("android_system_share".equals(sourceType) && !sourceType.equals(entry.metadata.sourceType))
                || entry.size != size
                || !contentSha256.equals(entry.sha256)
                || !entry.payloadFile().isFile()) continue;
            if (entry.payloadFile().length() == size && contentSha256.equals(sha256(entry.payloadFile()))) return entry;
        }
        return null;
    }

    private File record(String id) { return new File(items, id + ".properties"); }

    private void write(Entry entry) throws Exception {
        Properties value = new Properties();
        value.setProperty("collectionId", entry.collectionId);
        value.setProperty("studentId", entry.metadata.studentId);
        value.setProperty("sourceType", entry.metadata.sourceType);
        value.setProperty("fileName", entry.metadata.fileName);
        value.setProperty("mimeType", entry.metadata.mimeType);
        value.setProperty("sourceReference", entry.metadata.sourceReference);
        value.setProperty("size", String.valueOf(entry.size));
        value.setProperty("sha256", entry.sha256);
        value.setProperty("createdAt", String.valueOf(entry.createdAt));
        value.setProperty("state", entry.state.name());
        value.setProperty("payloadPath", entry.payloadPath);
        value.setProperty("uploadRequestId", entry.uploadRequestId);
        value.setProperty("lastError", entry.lastError);
        File target = record(entry.collectionId);
        File temp = new File(staging, entry.collectionId + ".properties.partial");
        FileOutputStream output = new FileOutputStream(temp);
        try { value.store(output, "student collection inbox"); output.flush(); output.getFD().sync(); }
        finally { output.close(); }
        move(temp, target);
    }

    private Entry read(File file) throws Exception {
        Properties value = new Properties();
        InputStream input = new FileInputStream(file);
        try { value.load(input); } finally { input.close(); }
        Metadata metadata = new Metadata(value.getProperty("studentId", ""), value.getProperty("sourceType", ""),
            value.getProperty("fileName", "资料"), value.getProperty("mimeType", "application/octet-stream"),
            value.getProperty("sourceReference", ""));
        return new Entry(value.getProperty("collectionId", ""), metadata,
            Long.parseLong(value.getProperty("size", "0")), value.getProperty("sha256", ""),
            Long.parseLong(value.getProperty("createdAt", "0")), State.valueOf(value.getProperty("state", "UNAVAILABLE")),
            value.getProperty("payloadPath", ""), value.getProperty("uploadRequestId", ""), value.getProperty("lastError", ""));
    }

    private static void mkdir(File dir) throws Exception { if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("Cannot create " + dir); }
    private static void move(File source, File target) throws Exception {
        if (source.renameTo(target)) return;
        if (target.exists() && !target.delete()) throw new IllegalStateException("Cannot replace " + target);
        if (source.renameTo(target)) return;
        InputStream input = new FileInputStream(source); OutputStream output = new FileOutputStream(target);
        try { byte[] buffer = new byte[64 * 1024]; int read; while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read); }
        finally { input.close(); output.close(); }
        if (!source.delete()) throw new IllegalStateException("Cannot delete staging file");
    }
    private static String clean(String value) { return value == null ? "" : value.trim(); }
    private static String safeName(String value) {
        String result = clean(value).replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        return result.length() == 0 ? "资料" : (result.length() > 160 ? result.substring(result.length() - 160) : result);
    }
    private static String hex(byte[] bytes) { StringBuilder out = new StringBuilder(); for (byte b : bytes) out.append(String.format("%02x", b & 0xff)); return out.toString(); }
    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        InputStream input = new FileInputStream(file);
        try { byte[] buffer = new byte[64 * 1024]; int read; while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read); }
        finally { input.close(); }
        return hex(digest.digest());
    }
}
