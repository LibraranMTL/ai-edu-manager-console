package com.qxmatrix.edumanager.standalone

import org.json.JSONArray

/** null means genuinely absent, never unreadable or corrupt. All instances share a process lock. */
interface StudentIndexStorage {
    fun read(): ByteArray?
    fun write(bytes: ByteArray)
    fun checkpoint(): ByteArray? = null
    fun saveCheckpoint(bytes: ByteArray) { }
    fun archiveDamaged(bytes: ByteArray) { error("未接入损坏索引保全") }
}

class StudentIndexUnavailableException(val reason: String, cause: Throwable) :
    IllegalStateException("学生索引${if (reason == "corrupt") "损坏" else "读取失败"}；已停止写入，请重试或恢复备份。", cause)

class StudentIndexStore(private val storage: StudentIndexStorage) {
    fun list(): List<StudentRecord> = synchronized(LOCK) { readStrict() }

    fun <T> mutate(change: (List<StudentRecord>) -> Pair<List<StudentRecord>, T>): T = synchronized(LOCK) {
        val current = readStrict() // MUST succeed before any mutation or write.
        val (next, result) = change(current)
        validate(next)
        if (next != current) {
            if (current.isNotEmpty()) storage.saveCheckpoint(encode(current))
            storage.write(encode(next))
        }
        result
    }

    fun recoveryPreview(): List<StudentRecord>? = synchronized(LOCK) {
        storage.checkpoint()?.let(::decode)
    }

    /** Explicit user recovery only. Never overwrites a currently healthy index, including []. */
    fun restoreCheckpoint(): List<StudentRecord> = synchronized(LOCK) {
        try { readStrict(); error("当前学生索引可正常读取，不能覆盖恢复") }
        catch (error: StudentIndexUnavailableException) { require(error.reason == "corrupt") { "读取权限异常时不能覆盖恢复" } }
        val next = requireNotNull(recoveryPreview()) { "没有可用的上次有效索引快照" }
        require(next.isNotEmpty()) { "不能用空快照覆盖已有档案" }
        val damaged = requireNotNull(storage.read()) { "索引已变化，请重新读取" }
        require(runCatching { decode(damaged) }.isFailure) { "索引已恢复可读，停止覆盖" }
        storage.archiveDamaged(damaged) // Must preserve damaged bytes BEFORE replacement.
        storage.write(encode(next))
        next
    }

    private fun encode(records: List<StudentRecord>): ByteArray = JSONArray().also { array -> records.forEach { array.put(it.toJson()) } }
        .toString(2).toByteArray(Charsets.UTF_8)

    private fun decode(bytes: ByteArray): List<StudentRecord> {
        val array = JSONArray(bytes.toString(Charsets.UTF_8))
        return List(array.length()) { StudentRecord.fromJson(array.getJSONObject(it)) }.also(::validate)
    }

    private fun readStrict(): List<StudentRecord> {
        val bytes = try { storage.read() } catch (error: Exception) {
            throw StudentIndexUnavailableException("unreadable", error)
        } ?: return emptyList()
        return try {
            decode(bytes)
        } catch (error: Exception) { throw StudentIndexUnavailableException("corrupt", error) }
    }

    private fun validate(records: List<StudentRecord>) {
        require(records.all { it.id.isNotBlank() && it.storageRootUri.isNotBlank() }) { "学生身份或存储授权为空" }
        require(records.map { it.id }.distinct().size == records.size) { "学生 ID 重复" }
        require(records.map { it.name }.distinct().size == records.size) { "学生姓名重复" }
    }

    companion object { private val LOCK = Any() }
}
