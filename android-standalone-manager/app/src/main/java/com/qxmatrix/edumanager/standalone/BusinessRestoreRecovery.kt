package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Durable cross-store rollback checkpoint. User originals in SAF are never deleted by recovery. */
object BusinessRestoreRecovery {
    private val lock = Any()
    private val applying = ThreadLocal<Boolean>()
    const val PREFIX = "business-restore/"
    private const val JOURNAL = "${PREFIX}journal.json"
    private const val COMMIT_KEY = "restore-operation"
    fun pending(context: Context): Boolean = PrivateStateStore(context).readIfPresent(JOURNAL)?.let {
        JSONObject(it.toString(Charsets.UTF_8)).getString("phase") == "applying"
    } ?: false

    fun recover(context: Context, db: BusinessDatabase = BusinessDatabase.get(context)) = synchronized(lock) {
        if (applying.get() == true) return@synchronized
        val state = PrivateStateStore(context)
        val bytes = state.readIfPresent(JOURNAL) ?: return@synchronized
        val journal = JSONObject(bytes.toString(Charsets.UTF_8))
        if (journal.getString("phase") != "applying") return@synchronized
        val id = journal.getString("id")
        if (db.tasks().metadata(COMMIT_KEY) == id) {
            state.writeBytes(JOURNAL, journal.put("phase", "committed").toString().toByteArray()); return@synchronized
        }
        val previous = journal.getJSONArray("previous").strings().toSet()
        previous.forEach { path -> state.writeBytes(path, state.readBytes("${PREFIX}rollback/$id/$path")) }
        val stateRoot = File(context.filesDir, "education-manager-state").canonicalFile
        journal.getJSONArray("planned").strings().filterNot(previous::contains).forEach { path ->
            val target = WorkspacePath.segments(path).fold(stateRoot) { parent, segment -> File(parent, segment) }.canonicalFile
            require(target.path.startsWith(stateRoot.path + File.separator))
            listOf(target, File(target.path + ".bak"), File(target.path + ".new")).forEach { file ->
                if (file.isFile) check(file.delete()) { "恢复回滚文件未能清理；停止后续处理" }
            }
        }
        val prefs = journal.getJSONObject("preferences")
        // Legacy journals may still contain a gateway object. It is intentionally ignored:
        // the controlled-gateway feature is no longer a runtime setting in the standalone app.
        SafRootGrant(context).restoreDefaultForRollback(prefs.optString("root").takeIf(String::isNotBlank)?.let(Uri::parse))
        UiPreferences(context).apply { setSkin(UiSkin.from(prefs.getString("skin"))); setLayoutMode(UiLayoutMode.from(prefs.getString("layout"))) }
        prefs.optJSONArray("homePins")?.let { pins -> context.getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, Context.MODE_PRIVATE).edit().putStringSet("home_pins", List(pins.length()) { pins.getString(it) }.toSet()).commit() }
        val agent = prefs.getJSONObject("agent")
        AgentConfigurationStore(context).restoreSnapshot(AgentConfigurationSnapshot(agent.getString("endpoint"), agent.getString("model"), agent.getString("visionModel"), agent.getString("encryptedCredential")))
        prefs.optJSONObject("asr")?.let { asr -> AgentConfigurationStore(context, "local_asr").restoreSnapshot(AgentConfigurationSnapshot(asr.getString("endpoint"), asr.getString("model"), asr.getString("visionModel"), asr.getString("encryptedCredential"))) }
        state.writeBytes(JOURNAL, journal.put("phase", "rolled_back").toString().toByteArray())
    }

    fun <T> apply(context: Context, stateRoot: File, db: BusinessDatabase, action: () -> T): T = synchronized(lock) {
        recover(context, db)
        val state = PrivateStateStore(context)
        val id = UUID.randomUUID().toString()
        val currentRoot = File(context.filesDir, "education-manager-state")
        val previous = if (currentRoot.isDirectory) currentRoot.walkTopDown().filter {
            it.isFile && !it.name.endsWith(".bak") && !it.name.endsWith(".new") && !it.relativeTo(currentRoot).invariantSeparatorsPath.startsWith(PREFIX)
        }.map { it.relativeTo(currentRoot).invariantSeparatorsPath }.toList() else emptyList()
        previous.forEach { path -> state.writeBytes("${PREFIX}rollback/$id/$path", state.readBytes(path)) }
        val planned = stateRoot.walkTopDown().filter(File::isFile).map { it.relativeTo(stateRoot).invariantSeparatorsPath }.toList()
        require(planned.none { it.startsWith(PREFIX) }) { "迁移包不得覆盖本机恢复日志" }
        val agent = AgentConfigurationStore(context).snapshotForRollback()
        val asr = AgentConfigurationStore(context, "local_asr").snapshotForRollback()
        val prefs = JSONObject().put("root", SafRootGrant(context).currentRootUri()?.toString().orEmpty())
            .put("homePins", JSONArray(context.getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, Context.MODE_PRIVATE).getStringSet("home_pins", emptySet()).orEmpty().toList()))
            .put("skin", UiPreferences(context).skin().wireValue).put("layout", UiPreferences(context).layoutMode().wireValue)
            .put("agent", JSONObject().put("endpoint", agent.endpoint).put("model", agent.model).put("visionModel", agent.visionModel).put("encryptedCredential", agent.encryptedCredential))
            .put("asr", JSONObject().put("endpoint", asr.endpoint).put("model", asr.model).put("visionModel", asr.visionModel).put("encryptedCredential", asr.encryptedCredential))
        val journal = JSONObject().put("id", id).put("phase", "applying").put("previous", JSONArray(previous)).put("planned", JSONArray(planned)).put("preferences", prefs)
        state.writeBytes(JOURNAL, journal.toString().toByteArray())
        applying.set(true)
        try {
            val result = db.runInTransaction(java.util.concurrent.Callable {
                val result = action()
                db.tasks().metadata(BusinessMetadataEntity(COMMIT_KEY, id)); result
            })
            // The DB commit is authoritative. A failed post-commit checkpoint is finalized on next startup.
            runCatching { state.writeBytes(JOURNAL, journal.put("phase", "committed").toString().toByteArray()) }
            result
        } catch (error: Throwable) {
            applying.remove()
            try { recover(context, db) } catch (rollback: Throwable) { error.addSuppressed(rollback) }
            throw error
        } finally { applying.remove() }
    }
}
