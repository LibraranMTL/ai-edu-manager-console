package com.qxmatrix.edumanager.standalone

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.Executors

class StudentIndexStoreTest {
    private class Memory : StudentIndexStorage {
        var bytes: ByteArray? = null
        var writes = 0
        var unreadable = false
        var snapshot: ByteArray? = null
        var archived: ByteArray? = null
        override fun read(): ByteArray? { if (unreadable) error("permission denied"); return bytes }
        override fun write(bytes: ByteArray) { this.bytes = bytes; writes++ }
        override fun checkpoint() = snapshot
        override fun saveCheckpoint(bytes: ByteArray) { snapshot = bytes }
        override fun archiveDamaged(bytes: ByteArray) { archived = bytes }
    }
    private fun record(name: String) = StudentRecord.create(name, "", "", "", "standard", "content://root")
    @Test fun missingIsNewUserButCorruptIsNeverEmpty() {
        val memory = Memory(); val store = StudentIndexStore(memory)
        assertTrue(store.list().isEmpty())
        memory.bytes = "broken".toByteArray()
        try { store.mutate { (it + record("甲")) to Unit }; fail() } catch (error: StudentIndexUnavailableException) {
            assertEquals("corrupt", error.reason)
        }
        assertEquals(0, memory.writes); assertEquals("broken", memory.bytes!!.toString(Charsets.UTF_8))
    }
    @Test fun unreadableAndDuplicateIdentityBlockWrites() {
        val memory = Memory(); val store = StudentIndexStore(memory); memory.unreadable = true
        try { store.list(); fail() } catch (error: StudentIndexUnavailableException) { assertEquals("unreadable", error.reason) }
        memory.unreadable = false; val one = record("甲")
        memory.bytes = JSONArray().put(one.toJson()).put(one.toJson()).toString().toByteArray()
        try { store.mutate { emptyList<StudentRecord>() to Unit }; fail() } catch (_: StudentIndexUnavailableException) { }
        assertEquals(0, memory.writes)
    }
    @Test fun differentRepositoryInstancesSerializeReadModifyWrite() {
        val memory = Memory(); val executor = Executors.newFixedThreadPool(4)
        try {
            val futures = (1..40).map { n -> executor.submit {
                StudentIndexStore(memory).mutate { current -> (current + record("学生$n")) to Unit }
            } }
            futures.forEach { it.get() }
            assertEquals(40, StudentIndexStore(memory).list().size)
        } finally { executor.shutdownNow() }
    }
    @Test fun optionalWindowsFieldsAndUnknownFieldsSurviveUpdates() {
        val json = record("甲").toJson().put("remoteChannel", "wecom").put("agentName", "Existing")
            .put("futureField", "keep").put("interests", JSONArray().put("物理"))
        val student = StudentRecord.fromJson(json)
        val updated = student.copy(planningProfile = student.planningProfile.copy(currentRegion = "上海")).toJson()
        assertEquals("wecom", updated.getString("remoteChannel")); assertEquals("keep", updated.getString("futureField"))
        assertEquals("Existing", updated.getString("agentName")); assertEquals("物理", updated.getJSONArray("interests").getString(0))
        assertEquals(2, updated.getInt("planningProfileSchemaVersion"))
    }
    @Test fun checkpointRecoveryRequiresCorruptIndexAndPreservesDamagedBytes() {
        val memory = Memory(); val store = StudentIndexStore(memory); val original = record("甲")
        store.mutate { listOf(original) to Unit }
        store.mutate { (it + record("乙")) to Unit }
        try { store.restoreCheckpoint(); fail() } catch (_: IllegalStateException) { }
        assertNull(memory.archived)
        memory.bytes = "broken".toByteArray()
        assertEquals(original.id, store.recoveryPreview()!!.single().id)
        assertEquals(original.id, store.restoreCheckpoint().single().id)
        assertEquals("broken", memory.archived!!.toString(Charsets.UTF_8))
        assertEquals(original.id, store.list().single().id)
    }
    @Test fun corruptCheckpointCannotReplaceCorruptIndex() {
        val memory = Memory(); val store = StudentIndexStore(memory)
        memory.bytes = "broken-index".toByteArray(); memory.snapshot = "broken-snapshot".toByteArray()
        try { store.restoreCheckpoint(); fail() } catch (_: Exception) { }
        assertEquals(0, memory.writes); assertNull(memory.archived)
    }
}
