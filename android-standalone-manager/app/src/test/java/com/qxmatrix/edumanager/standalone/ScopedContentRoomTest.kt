package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.Callable
import java.util.concurrent.Executors

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class ScopedContentRoomTest {
    @Test fun humanReviewIsAppendOnlyScopedAndNeverMastery() = database { repo, _ ->
        val version = repo.insertVersion("a", "card", "card", payload())
        val attempt = repo.attempt("a", version.id, JSONObject().put("text", "answer"))
        val hash = ScopedContentPolicy.hash(attempt.payload.toByteArray())
        val review = repo.review("a", attempt.id, hash, "partial", "家长", "在提示后完成", "review-one")
        assertEquals(review.id, repo.review("a", attempt.id, hash, "partial", "家长", "在提示后完成", "review-one").id)
        repo.review("a", attempt.id, hash, "revise", "家长", "更正之前评价", "review-two")
        assertEquals(2, repo.list("a", listOf("review")).size)
        assertEquals(attempt.payload, repo.exact("a", attempt.id).payload)
        assertEquals("reviewed", repo.exact("a", attempt.id).state)
        assertTrue(JSONObject(review.payload).isNull("masteryConclusion"))
        assertFalse(JSONObject(review.payload).getBoolean("identityVerified"))
        assertThrows(IllegalArgumentException::class.java) { repo.review("b", attempt.id, hash, "correct", "老师", "完整作答依据", "bad") }
        assertThrows(IllegalArgumentException::class.java) { repo.review("a", attempt.id, "stale", "correct", "老师", "完整作答依据", "bad") }
        Unit
    }
    @Test fun actionProgressIsAtomicIdempotentAndRejectsStaleState() = database { repo, _ ->
        val version = repo.insertVersion("a", "topic", "topic", payload("topics"))
        val action = repo.adopt("a", version.id, 0)
        assertEquals(action.id, repo.adopt("a", version.id, 0).id)
        val event = repo.actionProgress("a", action.id, "planned", "doing", "已经开始准备", "event-one")
        assertEquals(event.id, repo.actionProgress("a", action.id, "planned", "doing", "已经开始准备", "event-one").id)
        assertThrows(IllegalArgumentException::class.java) { repo.actionProgress("a", action.id, "planned", "done", "已经完成任务", "stale") }
        assertEquals(1, repo.list("a", listOf("action_event")).size)
        assertFalse(JSONObject(action.payload).getBoolean("formalOutcome"))
        assertThrows(IllegalArgumentException::class.java) { repo.actionProgress("b", action.id, "doing", "done", "已经完成任务", "cross") }
        val ignored = repo.ignore("a", version.id, 0)
        repo.restoreIgnored("a", ignored.id)
        assertEquals("restored", repo.exact("a", ignored.id).state)
        assertEquals("ignored", repo.ignore("a", version.id, 0).state)
        assertEquals(1, repo.filtered("a", "action", "topic").size)
        assertTrue(repo.filtered("b", "action", "").isEmpty())
        Unit
    }
    private fun payload(module: String = "cards") = JSONObject().put("module", module)
        .put("result", JSONObject().put("items", JSONArray().put(JSONObject().put("title", "实验选题").put("question", "题目").put("answer", "答案"))))
    private fun <T> database(block: (ScopedContentRepository, BusinessDatabase) -> T): T {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val db = Room.inMemoryDatabaseBuilder(context, BusinessDatabase::class.java).build()
        val executor = Executors.newSingleThreadExecutor()
        return try { executor.submit(Callable { block(ScopedContentRepository(context, db) { require(it in setOf("a", "b")) }, db) }).get() }
        finally { db.close(); executor.shutdownNow() }
    }
    @Test fun immutableVersionIdempotencyAndStudentIsolation() = database { repo, _ ->
        val a = repo.insertVersion("a", "key", "title", payload())
        assertEquals(a.id, repo.insertVersion("a", "key", "ignored", payload()).id)
        assertThrows(IllegalArgumentException::class.java) { repo.insertVersion("a", "key", "title", payload().put("changed", true)) }
        assertThrows(IllegalArgumentException::class.java) { repo.exact("b", a.id) }
        assertTrue(repo.search("b", "title").isEmpty())
    }
    @Test fun favoritesKeepSnapshotAndReviveWithoutDuplicating() = database { repo, _ ->
        val a = repo.insertVersion("a", "key", "title", payload())
        val favorite = repo.favorite("a", a.id)
        repo.insertVersion("a", "new-key", "new-title", payload().put("new", true))
        assertEquals(a.payload, repo.exact("a", favorite.id).payload)
        repo.removeFavorite("a", favorite.id)
        assertTrue(repo.list("a", listOf("favorite")).isEmpty())
        assertEquals(favorite.id, repo.favorite("a", a.id).id)
        assertEquals(1, repo.list("a", listOf("favorite")).size)
        assertThrows(IllegalArgumentException::class.java) { repo.removeFavorite("b", favorite.id) }
        Unit
    }
    @Test fun attemptNeverClaimsMasteryAndDraftDoesNotCreateProject() = database { repo, db ->
        val card = repo.insertVersion("a", "cards", "cards", payload())
        val attempt = repo.attempt("a", card.id, JSONObject().put("text", "answer"))
        assertEquals("recorded", attempt.state)
        assertTrue(JSONObject(attempt.payload).isNull("masteryConclusion"))
        assertEquals(card.payload, JSONObject(attempt.payload).getJSONObject("evidenceSnapshot").toString())
        val topic = repo.insertVersion("a", "topic", "topic", payload("topics"))
        val draft = repo.draft("a", topic.id, 0)
        assertEquals(draft.id, repo.draft("a", topic.id, 0).id)
        assertFalse(JSONObject(draft.payload).getBoolean("projectCreated"))
        assertTrue(db.tasks().all().isEmpty())
        assertThrows(IllegalArgumentException::class.java) { repo.attempt("a", topic.id, JSONObject()) }
        Unit
    }
    @Test fun literalWildcardSearchAndPartialRebuildDoNotEraseOldRows() = database { repo, _ ->
        val now = Timestamp.now()
        val first = ScopedContentEntity("one", "a", "search", "one", "100%_\\match", "body", "root", "a/file", "hash", "", "indexed", now, now, "{}")
        repo.replaceSearch("a", listOf(first), true)
        assertEquals("one", repo.search("a", "%_\\").single().id)
        assertTrue(repo.search("b", "").isEmpty())
        repo.replaceSearch("a", emptyList(), false)
        assertEquals(1, repo.search("a", "").size)
        repo.replaceSearch("a", emptyList(), true)
        assertTrue(repo.search("a", "").isEmpty())
    }
    @Test fun publishedReportPathsRemainDiscoverableWhenOtherArchiveScanningIsPartial() = database { repo, _ ->
        val now = Timestamp.now()
        val report = ScopedContentEntity("report", "a", "search", "report", "整体画像", "---\nstatus: active\npublication_mode: direct\npublished_at: 2026-11-15\n---", "root", "档案/学情报告/整体画像.md", "hash", "", "indexed", now, now, "{}")
        val unrelated = ScopedContentEntity("raw", "a", "search", "raw", "原始资料", "body", "root", "档案/原始资料/旧文件.md", "hash2", "", "indexed", now, now, "{}")
        repo.replaceSearch("a", listOf(report, unrelated), true)
        // An incomplete later rebuild must retain the report projection it was able to refresh.
        repo.replaceSearch("a", listOf(report), false)
        assertEquals(listOf("report"), repo.indexedPersonalSearchAtPaths("a", listOf("档案/学情报告/整体画像.md")).map { it.id })
        assertTrue(LearningStudioPolicy.recentPublished(repo.exact("a", "report").bodyText))
        Unit
    }
    @Test fun contentAndSearchWriteRollbackTogether() = database { repo, _ ->
        assertThrows(IllegalStateException::class.java) { repo.transaction("a") { repo.insertVersion("a", "key", "title", payload()); error("injected") } }
        assertTrue(repo.list("a", listOf("artifact")).isEmpty())
    }
    @Test fun pageCheckpointsAreImmutableAndScoped() = database { repo, _ ->
        val payload = JSONObject().put("sourceSha256", "hash").put("page", 1).put("text", "recognized")
        repo.saveCheckpoint("a", "ocr_page", "source-page", payload)
        assertEquals("recognized", repo.checkpoint("a", "ocr_page", "source-page")!!.getString("text"))
        assertNull(repo.checkpoint("b", "ocr_page", "source-page"))
        assertThrows(IllegalArgumentException::class.java) { repo.saveCheckpoint("a", "ocr_page", "source-page", payload.put("text", "changed")) }
        Unit
    }
    @Test fun ignoredChoiceIsIdempotentAndDoesNotMutateCandidate() = database { repo, _ ->
        val version = repo.insertVersion("a", "topic", "topics", payload("topics"))
        val ignored = repo.ignore("a", version.id, 0)
        assertEquals(ignored.id, repo.ignore("a", version.id, 0).id)
        assertEquals(version.payload, repo.exact("a", version.id).payload)
        assertEquals("ignored", ignored.state)
    }
}
