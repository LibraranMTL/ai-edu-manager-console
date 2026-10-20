package com.qxmatrix.edumanager.standalone

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri

class SafRootGrant(context: Context) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun createPickerIntent(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
    }

    fun acceptPickerResult(data: Intent): Result<Uri> = acceptTreeResult(data, saveAsDefault = true)

    fun acceptAdditionalTreeResult(data: Intent): Result<Uri> = acceptTreeResult(data, saveAsDefault = false)

    @SuppressLint("WrongConstant") // Android's lint does not infer the documented read/write flag mask.
    private fun acceptTreeResult(data: Intent, saveAsDefault: Boolean): Result<Uri> = runCatching {
        val uri = requireNotNull(data.data) { "The document provider did not return a directory" }
        val requiredFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        val grantedFlags = data.flags and requiredFlags
        require(grantedFlags == requiredFlags) { "The selected directory must grant read and write access" }
        appContext.contentResolver.takePersistableUriPermission(uri, grantedFlags)
        if (saveAsDefault) {
            preferences.edit().putString(ROOT_URI_KEY, uri.toString()).commit().also {
                check(it) { "Unable to persist the selected directory" }
            }
        }
        uri
    }

    fun currentRootUri(): Uri? = preferences.getString(ROOT_URI_KEY, null)?.let(Uri::parse)
    /** Restore an existing preference checkpoint; a revoked grant remains visibly unavailable. */
    internal fun restoreDefaultForRollback(uri: Uri?) {
        check(preferences.edit().apply { if (uri == null) remove(ROOT_URI_KEY) else putString(ROOT_URI_KEY, uri.toString()) }.commit())
    }

    fun setDefaultRoot(uri: Uri) {
        require(appContext.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission && it.isWritePermission }) {
            "The restored workspace root does not have a persisted read/write grant"
        }
        check(preferences.edit().putString(ROOT_URI_KEY, uri.toString()).commit()) { "Unable to persist the restored workspace root" }
    }

    companion object {
        private const val PREFERENCES_NAME = "standalone_workspace"
        private const val ROOT_URI_KEY = "saf_root_uri"
    }
}
