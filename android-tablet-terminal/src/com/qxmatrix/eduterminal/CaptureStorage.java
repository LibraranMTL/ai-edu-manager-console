package com.qxmatrix.eduterminal;

import android.content.Context;
import android.os.Environment;

import java.io.File;
import java.util.Locale;

final class CaptureStorage {
    private CaptureStorage() {}

    static File root(Context context) {
        return new File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "screen-captures");
    }

    static String studentKey(String studentId) {
        String source = studentId == null ? "" : studentId.trim();
        if (source.length() == 0) return "unassigned";
        String clean = source.replaceAll("[^A-Za-z0-9._-]", "_");
        if (clean.length() == 0) clean = "student";
        if (clean.length() > 40) clean = clean.substring(0, 40);
        return clean + "-" + Integer.toHexString(source.hashCode());
    }

    static File studentDir(Context context, String studentId) {
        return new File(root(context), studentKey(studentId));
    }

    static boolean isImage(File file) {
        if (file == null || !file.isFile()) return false;
        String lower = file.getName().toLowerCase(Locale.ROOT);
        return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png");
    }

    static boolean isInside(File child, File parent) {
        try {
            String childPath = child.getCanonicalPath();
            String parentPath = parent.getCanonicalPath();
            return childPath.equals(parentPath) || childPath.startsWith(parentPath + File.separator);
        } catch (Exception ignored) {
            return false;
        }
    }

    static long sizeOf(File file) {
        if (file == null || !file.exists()) return 0L;
        if (file.isFile()) return file.length();
        long total = 0L;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) total += sizeOf(child);
        return total;
    }

    static int imageCount(File directory) {
        int count = 0;
        File[] children = directory == null ? null : directory.listFiles();
        if (children != null) for (File child : children) if (isImage(child)) count += 1;
        return count;
    }

    static boolean deleteTree(File target, File allowedRoot) {
        if (target == null || allowedRoot == null || !isInside(target, allowedRoot) || target.equals(allowedRoot)) return false;
        File[] children = target.listFiles();
        if (children != null) {
            for (File child : children) {
                if (child.isDirectory()) deleteTree(child, allowedRoot);
                else if (isInside(child, allowedRoot)) child.delete();
            }
        }
        return target.delete();
    }
}
