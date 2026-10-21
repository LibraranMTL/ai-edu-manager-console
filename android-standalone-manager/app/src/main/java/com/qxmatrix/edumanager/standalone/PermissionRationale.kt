package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.app.AlertDialog

object PermissionRationale {
    fun request(
        activity: Activity,
        permission: String,
        requestCode: Int,
        titleRes: Int,
        reasonRes: Int,
        onDeclined: () -> Unit = {},
    ) {
        AlertDialog.Builder(activity)
            .setTitle(titleRes)
            .setMessage(reasonRes)
            .setNegativeButton("暂不允许") { _, _ -> onDeclined() }
            .setPositiveButton("继续") { _, _ -> activity.requestPermissions(arrayOf(permission), requestCode) }
            .show()
    }
}
