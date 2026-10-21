package com.qxmatrix.edumanager.standalone

import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.WorkRequest
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

enum class UserWorkState(val wireValue: String, val label: String) {
    WAITING("waiting", "等待"),
    RUNNING("running", "运行"),
    NEEDS_HELP("needs_help", "需要帮助"),
    COMPLETED("completed", "完成"),
    FAILED("failed", "失败");

    companion object {
        fun fromInternal(value: String) = when (value) {
            "queued", "pending", "approved", "waiting_result" -> WAITING
            "running", "reviewing" -> RUNNING
            "needs_user", "unknown" -> NEEDS_HELP
            "completed", "succeeded", "committed", "delivered" -> COMPLETED
            else -> FAILED
        }
    }
}

/** One policy for persistent work; per-student names serialize work without serializing other students. */
object BackgroundWorkPolicy {
    val remoteConstraints: Constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .setRequiresBatteryNotLow(true)
        .setRequiresStorageNotLow(true)
        .build()

    val unmeteredChargingConstraints: Constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.UNMETERED)
        .setRequiresCharging(true)
        .setRequiresStorageNotLow(true)
        .build()

    val localConstraints: Constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
        .setRequiresBatteryNotLow(true)
        .setRequiresStorageNotLow(true)
        .build()

    fun uniqueName(kind: String, studentId: String): String {
        require(kind.matches(Regex("^[a-z0-9-]{2,60}$")) && studentId.isNotBlank())
        return "edu-$kind-student-${fingerprint(studentId).take(20)}"
    }

    fun idempotencyKey(kind: String, studentId: String, sourceFingerprint: String): String =
        fingerprint("$kind\u0000$studentId\u0000$sourceFingerprint")

    fun <B : WorkRequest.Builder<B, *>> applyRemote(builder: B): B = builder
        .setConstraints(remoteConstraints)
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)

    private fun fingerprint(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}
