package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Bounded compensation scan. It registers authorized files but never moves or digests them. */
class ProjectMaterialMaintenanceWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val service = LocalProjectMaterialService(applicationContext)
        val outcomes = JSONArray()
        ProjectRepository(applicationContext).list().filter { it.status !in setOf("sealed", "archived") }.take(MAX_PROJECTS).forEach { project ->
            val outcome = JSONObject().put("projectId", project.id).put("projectName", project.name)
            runCatching {
                if (project.materialMigrationState == "running") service.recoverMigration(project.id)
                service.scanWorkspace(project.id)
            }.onSuccess {
                outcome.put("status", "completed").put("added", it.added).put("updated", it.updated)
                    .put("unavailable", it.unavailable).put("coverage", if (it.truncated) "partial" else "complete")
            }.onFailure { outcome.put("status", "failed").put("message", (it.message ?: "扫描失败").take(500)) }
            outcomes.put(outcome)
        }
        PrivateStateStore(applicationContext).writeBytes(STATE_PATH, (JSONObject().put("schema", STATE_SCHEMA)
            .put("completedAt", Timestamp.now()).put("projects", outcomes).toString(2) + "\n").toByteArray())
        return Result.success()
    }

    companion object {
        private const val UNIQUE_WORK = "android-standalone-project-material-maintenance"
        private const val STATE_PATH = "project-material-maintenance.json"
        private const val STATE_SCHEMA = "edu-manager.android-project-material-maintenance.v1"
        private const val MAX_PROJECTS = 50

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<ProjectMaterialMaintenanceWorker>(24, TimeUnit.HOURS)
                .setConstraints(BackgroundWorkPolicy.localConstraints).build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniquePeriodicWork(UNIQUE_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
