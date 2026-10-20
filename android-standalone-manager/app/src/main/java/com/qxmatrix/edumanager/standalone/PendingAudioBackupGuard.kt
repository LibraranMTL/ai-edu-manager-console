package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject
import java.io.File

/** Unarchived microphone cache is not a durable source. Never silently omit it in a backup. */
object PendingAudioBackupGuard {
    fun requireArchived(context: Context) {
        val directory = File(context.filesDir, "education-manager-state/audio-capture")
        if (!directory.exists()) return
        require(directory.isDirectory) { "录音恢复记录异常，请先核对录音" }
        val files = requireNotNull(directory.listFiles()) { "无法读取待归档录音清单" }
        val paths = files.map { it.name.removeSuffix(".bak").removeSuffix(".new") }.distinct()
        val store = PrivateStateStore(context)
        paths.forEach { name ->
            require(name.endsWith(".json")) { "录音恢复记录异常，请先核对" }
            val bytes = requireNotNull(store.readIfPresent("audio-capture/$name"))
            require(JSONObject(bytes.toString(Charsets.UTF_8)).optString("cacheName").isBlank()) {
                "存在尚未归档的录音。请在录音页面保存原件或明确丢弃，再执行完整备份/迁移；录音缓存不会被悄悄遗漏。"
            }
        }
    }
}
