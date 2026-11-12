package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.content.ContextWrapper
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class StudentLearningStateTest {
    @Test fun selfReportIsStudentScopedAndNotAnAssessment() {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val root = File(base.cacheDir, "self-report-test-${UUID.randomUUID()}").apply { mkdirs() }
        val context = object : ContextWrapper(base) {
            override fun getFilesDir() = root
            override fun getApplicationContext(): Context = this
        }
        val a = StudentRecord.create("合成甲", "", "", "", "standard", "content://synthetic")
        val b = StudentRecord.create("合成乙", "", "", "", "standard", "content://synthetic")
        PrivateStateStore(context).writeBytes("students.json", JSONArray().put(a.toJson()).put(b.toJson()).toString().toByteArray())
        val store = StudentLearningState(context)
        assertNull(store.read(b.id))
        val oldPath = "learning-self-report/${ScopedContentPolicy.hash(a.id.toByteArray())}.json"
        val old = JSONObject().put("schema", "edu-manager.learning-self-report.v1").put("studentId", a.id)
            .put("goal", "旧目标").put("state", "旧状态").put("kind", "self_report")
        PrivateStateStore(context).writeBytes(oldPath, old.toString().toByteArray())
        assertEquals("旧目标", store.read(a.id)!!.getString("goal"))
        assertEquals("", store.read(a.id)!!.optString("problem"))
        store.save(a.id, "完成绘图", "今天有些疲惫")
        assertEquals("self_report", store.read(a.id)!!.getString("kind"))
        assertEquals("今天有些疲惫", store.read(a.id)!!.getString("state"))
        assertNull(store.read(b.id))
        assertThrows(NoSuchElementException::class.java) { store.read("other-student") }
        store.save(a.id, "新目标", "平稳", "难点", "分步练习", "有待改善")
        val updated = store.read(a.id)!!
        assertEquals("难点", updated.getString("problem"))
        assertEquals("分步练习", updated.getString("method"))
        assertEquals("有待改善", updated.getString("efficiency"))
        assertEquals("self_report", updated.getString("kind"))
        assertNull(store.read(b.id))
        assertThrows(IllegalArgumentException::class.java) { store.save(a.id, "", "", "", "", "") }
        assertEquals("难点", store.read(a.id)!!.getString("problem"))
    }
}
