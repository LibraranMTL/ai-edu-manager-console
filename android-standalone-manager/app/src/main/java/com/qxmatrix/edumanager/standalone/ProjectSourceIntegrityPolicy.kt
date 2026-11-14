package com.qxmatrix.edumanager.standalone

import org.json.JSONObject

/** A derived project artifact is current only while its recorded source is still current. */
object ProjectSourceIntegrityPolicy {
    fun matches(source: JSONObject, item: JSONObject?, actualSha256: String?): Boolean {
        val id = source.optString("materialId")
        val hash = source.optString("sha256")
        val version = source.optInt("version")
        return id.isNotBlank() && version > 0 && hash.matches(Regex("[0-9a-f]{64}")) && item != null &&
            item.optString("materialId") == id && item.optString("adoption") == "accepted" &&
            item.optInt("version") == version && item.optString("sha256") == hash && actualSha256 == hash
    }
}
