package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TaskCenterPolicyTest {
    @Test fun studentOwnsConversationAndOtherStudentsProjectTasksStayHidden() {
        val conversation = JSONObject().put("sourceType", "conversation").put("sourceId", "record")
            .put("input", JSONObject().put("studentId", "a").put("projectId", "shared-project"))
        assertTrue(TaskCenterPolicy.visible(conversation, "a", setOf("shared-project")))
        assertFalse(TaskCenterPolicy.visible(conversation, "b", setOf("shared-project")))
        assertFalse(TaskCenterPolicy.visible(conversation, "", setOf("shared-project")))
        val project = JSONObject().put("sourceType", "project").put("sourceId", "shared-project")
        assertTrue(TaskCenterPolicy.visible(project, "b", setOf("shared-project")))
        assertFalse(TaskCenterPolicy.visible(project, "b", setOf("other-project")))
    }
    @Test fun legacyStatesMapWithoutChangingWireProtocol() {
        assertEquals("running", TaskCenterPolicy.viewState(JSONObject().put("status", "reviewing")))
        assertEquals("needs_user", TaskCenterPolicy.viewState(JSONObject().put("status", "failed").put("error", JSONObject().put("code", "process_interrupted"))))
        listOf("queued", "running", "waiting_network", "waiting_quota", "needs_user", "succeeded", "failed", "cancelled", "superseded").forEach {
            assertNotEquals("需要处理", TaskCenterPolicy.label(it))
        }
    }
    @Test fun malformedAndDuplicateLegacyTasksAreRejected() {
        assertThrows(Exception::class.java) { LegacyTaskCodec.decode("{broken".toByteArray(), null) }
        val task = TaskProtocol.envelope(JSONObject().put("id", "same"))
        val duplicate = JSONObject().put("protocolVersion", "1.2").put("tasks", org.json.JSONArray().put(task).put(task)).toString().toByteArray()
        assertThrows(IllegalArgumentException::class.java) { LegacyTaskCodec.decode(duplicate, null) }
        assertTrue(LegacyTaskCodec.decode(null, null).tasks.isEmpty())
    }
}
