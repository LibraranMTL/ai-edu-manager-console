package com.qxmatrix.edumanager.standalone

import android.content.Context
import org.json.JSONObject
import java.io.File

/** Only routing/UI metadata travels to a new device. Credentials and activation never do. */
object PublicSettingsSnapshot {
    const val PATH = "settings/public-profile.json"
    fun exportBytes(context: Context): ByteArray = JSONObject().put("schema", "edu-manager.public-settings.v1")
        .put("homePins", org.json.JSONArray(context.getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, Context.MODE_PRIVATE).getStringSet("home_pins", emptySet()).orEmpty().toList()))
        .put("skin", UiPreferences(context).skin().wireValue).put("layout", UiPreferences(context).layoutMode().wireValue)
        .put("agent", AgentConfigurationStore(context).publicProfile()?.toJson() ?: JSONObject.NULL)
        .put("asr", AgentConfigurationStore(context, "local_asr").publicProfile()?.toJson() ?: JSONObject.NULL).toString().toByteArray()
    fun apply(context: Context, root: File) {
        val file = File(root, PATH); if (!file.isFile) return
        val value = JSONObject(file.readText()); require(value.getString("schema") == "edu-manager.public-settings.v1")
        UiPreferences(context).apply { setSkin(UiSkin.from(value.getString("skin"))); setLayoutMode(UiLayoutMode.from(value.getString("layout"))) }
        value.optJSONArray("homePins")?.let { pins -> context.getSharedPreferences(MainActivity.UI_CONTEXT_PREFS, Context.MODE_PRIVATE).edit().putStringSet("home_pins", List(pins.length()) { pins.getString(it) }.filter { it in setOf("PLANNING", "KNOWLEDGE", "COURSES", "SETTINGS") }.toSet()).commit() }
        AgentConfigurationStore(context).restorePublicProfile(value.optJSONObject("agent")?.let(AgentPublicConfiguration::fromJson))
        AgentConfigurationStore(context, "local_asr").restorePublicProfile(value.optJSONObject("asr")?.let(AgentPublicConfiguration::fromJson))
    }
}
