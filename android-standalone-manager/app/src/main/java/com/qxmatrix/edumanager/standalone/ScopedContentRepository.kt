package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.os.Looper
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Callable

class ScopedContentRepository(private val context: Context,
    private val db: BusinessDatabase = BusinessDatabase.get(context),
    private val validateStudent: (String) -> Unit = { StudentIndexRepository(context).requireExact(it); Unit }) {
    private val dao = db.content()
    fun <T> transaction(studentId: String, action: () -> T): T {
        require(studentId.isNotBlank()); check(Looper.myLooper() != Looper.getMainLooper()) { "内容索引须在后台访问" }
        validateStudent(studentId)
        if (!db.inTransaction()) BusinessRestoreRecovery.recover(context, db)
        return db.runInTransaction(Callable(action))
    }
    fun exact(studentId: String, id: String): ScopedContentEntity = transaction(studentId) {
        requireNotNull(dao.exact(studentId, id)) { "没有当前学生的指定记录" }.also { ScopedContentPolicy.requireScope(it, studentId) }
    }
    fun list(studentId: String, kinds: List<String>, limit: Int = 50, offset: Int = 0) = transaction(studentId) {
        dao.list(studentId, kinds, limit.coerceIn(1, 100), offset.coerceAtLeast(0))
    }
    fun search(studentId: String, query: String, offset: Int = 0) = transaction(studentId) { dao.search(studentId, ScopedContentPolicy.query(query), 50, offset.coerceAtLeast(0)) }
        .filter { row -> row.projectId.isBlank() || runCatching { ContentSourceResolver(context).locate(studentId, row) }.isSuccess }
    fun filtered(studentId: String, kind: String, query: String, offset: Int = 0) = transaction(studentId) {
        dao.filtered(studentId, kind, ScopedContentPolicy.query(query), offset.coerceAtLeast(0))
    }
    private fun ledger(studentId: String, kind: String, key: String, source: ScopedContentEntity, payload: JSONObject): ScopedContentEntity {
        require(key.isNotBlank() && key.length <= 200 && payload.toString().toByteArray().size <= 1_000_000)
        val hash = ScopedContentPolicy.fingerprint(payload)
        dao.byKey(studentId, kind, key)?.let { require(it.sourceSha256 == hash) { "操作键内容冲突" }; return it }
        val now = Timestamp.now()
        return source.copy(id = "$kind-${UUID.randomUUID()}", kind = kind, sourceKey = key, bodyText = payload.toString(),
            rootUri = "", logicalPath = "", sourceSha256 = hash, state = "recorded", createdAt = now, updatedAt = now,
            payload = payload.toString()).also(dao::insert)
    }
    fun review(studentId: String, attemptId: String, expectedHash: String, outcome: String, reviewer: String,
        note: String, operationId: String): ScopedContentEntity = transaction(studentId) {
        val attempt = exact(studentId, attemptId)
        require(attempt.kind == "attempt" && ScopedContentPolicy.hash(attempt.payload.toByteArray()) == expectedHash) { "作答已变化，请重新打开" }
        require(outcome in setOf("correct", "partial", "revise", "unverifiable"))
        require(reviewer.trim().length in 1..100 && note.trim().length in 4..2000) { "请填写审核人和至少4字的依据" }
        val payload = JSONObject().put("attemptId", attemptId).put("answerSnapshot", JSONObject(attempt.payload))
            .put("outcome", outcome).put("reviewer", reviewer.trim()).put("note", note.trim())
            .put("identityVerified", false).put("masteryConclusion", JSONObject.NULL)
        val row = ledger(studentId, "review", operationId, attempt, payload)
        require(dao.transition(studentId, attempt.id, attempt.state, "reviewed", Timestamp.now()) == 1)
        row
    }
    fun adopt(studentId: String, versionId: String, itemIndex: Int): ScopedContentEntity = transaction(studentId) {
        val version = exact(studentId, versionId); require(version.kind == "artifact")
        val root = JSONObject(version.payload); require(root.getString("module") != "cards")
        val item = root.getJSONObject("result").getJSONArray("items").getJSONObject(itemIndex)
        val key = "action:$versionId:$itemIndex"
        dao.byKey(studentId, "action", key)?.let { return@transaction it }
        val payload = JSONObject().put("versionId", versionId).put("itemIndex", itemIndex).put("module", root.getString("module"))
            .put("candidateSnapshot", root).put("suggestionSnapshot", root).put("itemSnapshot", item).put("formalOutcome", false)
        val row = ledger(studentId, "action", key, version, payload)
        require(dao.transition(studentId, row.id, "recorded", "planned", Timestamp.now()) == 1)
        row.copy(state = "planned")
    }
    fun actionProgress(studentId: String, actionId: String, expectedState: String, next: String, note: String,
        operationId: String): ScopedContentEntity = transaction(studentId) {
        val action = exact(studentId, actionId); require(action.kind == "action")
        require(expectedState in setOf("planned", "doing", "done", "paused") && next in setOf("planned", "doing", "done", "paused"))
        require(note.trim().length in 4..2000) { "请填写至少4字的进度或结果依据" }
        val payload = JSONObject().put("actionId", actionId).put("from", expectedState).put("to", next)
            .put("note", note.trim()).put("selfReported", true).put("formalOutcome", false)
        dao.byKey(studentId, "action_event", operationId)?.let {
            require(it.sourceSha256 == ScopedContentPolicy.fingerprint(payload)); return@transaction it
        }
        require(action.state == expectedState) { "进度已变化，请刷新后操作" }
        val event = ledger(studentId, "action_event", operationId, action, payload)
        require(dao.transition(studentId, actionId, expectedState, next, Timestamp.now()) == 1)
        event
    }
    fun restoreIgnored(studentId: String, id: String) = transaction(studentId) {
        require(dao.transition(studentId, id, "ignored", "restored", Timestamp.now()) == 1) { "忽略状态已变化" }
    }
    fun versionByKey(studentId: String, key: String) = transaction(studentId) { dao.byKey(studentId, "artifact", key) }
    fun checkpoint(studentId: String, kind: String, key: String): JSONObject? = transaction(studentId) {
        require(kind in setOf("ocr_page", "vision_page", "asr_result", "digest_result"))
        dao.byKey(studentId, kind, key)?.let {
            val payload = JSONObject(it.payload)
            require(it.sourceSha256 == ScopedContentPolicy.fingerprint(payload)) { "处理检查点哈希不匹配，原记录保留" }
            payload
        }
    }
    fun saveCheckpoint(studentId: String, kind: String, key: String, payload: JSONObject) = transaction(studentId) {
        require(kind in setOf("ocr_page", "vision_page", "asr_result", "digest_result") && payload.toString().toByteArray().size <= 500_000)
        val hash = ScopedContentPolicy.fingerprint(payload)
        dao.byKey(studentId, kind, key)?.let { require(it.sourceSha256 == hash) { "断点内容冲突" }; return@transaction }
        val now = Timestamp.now()
        dao.insert(ScopedContentEntity("checkpoint-${UUID.randomUUID()}", studentId, kind, key, kind, "", "", "", hash, "", "completed", now, now, payload.toString()))
    }
    fun insertVersion(studentId: String, sourceKey: String, title: String, payload: JSONObject, projectId: String = ""): ScopedContentEntity = transaction(studentId) {
        require(sourceKey.isNotBlank() && payload.toString().toByteArray().size <= 1_000_000)
        if (projectId.isNotBlank()) require(ProjectRepository(context).list().any { it.id == projectId && studentId in it.studentIds }) { "项目不属于当前学生" }
        dao.byKey(studentId, "artifact", sourceKey)?.let {
            require(it.sourceSha256 == ScopedContentPolicy.fingerprint(payload)) { "同一版本键的内容不一致，原版本保留" }
            return@transaction it
        }
        val now = Timestamp.now()
        val row = ScopedContentEntity("version-${UUID.randomUUID()}", studentId, "artifact", sourceKey, title, payload.toString(), "", "",
            ScopedContentPolicy.fingerprint(payload), projectId, "available", now, now, payload.toString())
        dao.insert(row); row
    }
    fun favorite(studentId: String, versionId: String): ScopedContentEntity = transaction(studentId) {
        val version = exact(studentId, versionId); require(version.kind == "artifact")
        val key = "favorite:$versionId"
        dao.byKey(studentId, "favorite", key)?.let { old -> dao.favoriteState(studentId, old.id, "saved", Timestamp.now()); return@transaction old.copy(state = "saved") }
        val now = Timestamp.now()
        val favorite = version.copy(id = "favorite-${UUID.randomUUID()}", kind = "favorite", sourceKey = key, state = "saved", createdAt = now, updatedAt = now)
        dao.insert(favorite); favorite
    }
    fun removeFavorite(studentId: String, id: String) = transaction(studentId) { require(dao.favoriteState(studentId, id, "removed", Timestamp.now()) == 1) }
    fun attempt(studentId: String, versionId: String, answer: JSONObject): ScopedContentEntity {
        val row = transaction(studentId) {
            val version = exact(studentId, versionId); require(version.kind == "artifact")
            require(JSONObject(version.payload).getString("module") == "cards") { "只能提交学习卡片作答" }
            require(answer.toString().toByteArray().size <= 200_000) { "作答内容过大" }
            val now = Timestamp.now(); val id = "attempt-${UUID.randomUUID()}"
            val payload = JSONObject().put("versionId", versionId).put("evidenceSnapshot", JSONObject(version.payload)).put("answer", answer)
                .put("status", "recorded").put("masteryConclusion", JSONObject.NULL)
            version.copy(id = id, kind = "attempt", sourceKey = id, state = "recorded", createdAt = now, updatedAt = now,
                bodyText = answer.toString(), payload = payload.toString()).also(dao::insert)
        }
        val event = JSONObject().put("sourceId", row.id).put("studentId", studentId).put("kind", "practice_attempt")
            .put("title", "完成学习卡片作答").put("time", row.createdAt).put("status", "recorded")
            .put("content", "作答已保存并进入学习反馈闭环")
        event.put("contentFingerprint", ScopedContentPolicy.fingerprint(event))
        HighGrowthRoomStore(context).mirrorAsync(studentId, HighGrowthRoomStore.LEARNING_EVENT, listOf(event))
        StudioAutomation.enqueueCheck(context, studentId)
        runCatching {
            AutomationOrchestrator(context).emit(AutomationEventType.LEARNING_CARD_ANSWERED, studentId,
                ScopedContentPolicy.fingerprint(JSONObject(row.payload)), listOf(row.id))
        }
        return row
    }
    fun draft(studentId: String, versionId: String, itemIndex: Int): ScopedContentEntity = transaction(studentId) {
        val version = exact(studentId, versionId); val root = JSONObject(version.payload)
        require(root.getString("module") == "topics") { "只有选题可准备项目草稿" }
        val item = root.getJSONObject("result").getJSONArray("items").getJSONObject(itemIndex)
        val key = "draft:$versionId:$itemIndex"
        dao.byKey(studentId, "draft", key)?.let { return@transaction it }
        val now = Timestamp.now()
        val row = version.copy(id = "draft-${UUID.randomUUID()}", kind = "draft", sourceKey = key, title = item.getString("title"), state = "ready",
            createdAt = now, updatedAt = now, payload = JSONObject().put("candidate", item).put("versionId", versionId)
                .put("suggestion", item).put("studentId", studentId).put("projectCreated", false).toString())
        dao.insert(row); row
    }
    fun insertInboxCandidate(studentId: String, submissionId: String, provider: String, payload: JSONObject,
        sourceFingerprint: String, projectId: String = ""): ScopedContentEntity = transaction(studentId) {
        require(Regex("^submission_[a-f0-9]{32}$").matches(submissionId)) { "成果标识无效" }
        require(provider.isNotBlank() && sourceFingerprint.matches(Regex("^[a-f0-9]{64}$"))) { "成果来源无效" }
        if (projectId.isNotBlank()) require(ProjectRepository(context).list().any { it.id == projectId && studentId in it.studentIds }) { "成果项目不属于当前学生" }
        val key = "cloud-inbox:$submissionId"
        dao.byKey(studentId, "inbox_candidate", key)?.let { old ->
            require(old.sourceSha256 == sourceFingerprint) { "同一成果编号内容不一致" }
            return@transaction old
        }
        val now = Timestamp.now()
        val wrapped = JSONObject().put("studentId", studentId).put("sourceId", submissionId).put("time", now)
            .put("provider", provider).put("projectId", projectId).put("contentFingerprint", sourceFingerprint)
            .put("status", "candidate").put("payload", payload)
        val row = ScopedContentEntity("inbox-${UUID.randomUUID()}", studentId, "inbox_candidate", key,
            "云端成果候选 · $provider", payload.toString(), "", "", sourceFingerprint, projectId, "candidate", now, now, wrapped.toString())
        dao.insert(row); row
    }
    fun ignore(studentId: String, versionId: String, itemIndex: Int): ScopedContentEntity = transaction(studentId) {
        val version = exact(studentId, versionId); require(version.kind == "artifact")
        val item = JSONObject(version.payload).getJSONObject("result").getJSONArray("items").getJSONObject(itemIndex)
        val key = "ignored:$versionId:$itemIndex"
        dao.byKey(studentId, "decision", key)?.let {
            require(dao.transition(studentId, it.id, it.state, "ignored", Timestamp.now()) == 1)
            return@transaction it.copy(state = "ignored")
        }
        val now = Timestamp.now()
        val row = version.copy(id = "decision-${UUID.randomUUID()}", kind = "decision", sourceKey = key, state = "ignored", createdAt = now, updatedAt = now,
            payload = JSONObject().put("versionId", versionId).put("itemIndex", itemIndex).put("itemSnapshot", item).toString())
        dao.insert(row); row
    }
    fun replaceSearch(studentId: String, rows: List<ScopedContentEntity>, complete: Boolean) = transaction(studentId) {
        require(rows.all { it.studentId == studentId && it.kind == "search" })
        if (complete) dao.staleProjection(studentId)
        rows.forEach(dao::project)
    }
}
