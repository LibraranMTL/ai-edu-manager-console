package com.qxmatrix.edumanager.standalone

import android.content.Context

/** A hard process stop is available solely in the isolated, explicitly selected fault-test build. */
internal object FaultInjection {
    fun hit(context: Context, boundary: String) {
        if (!BuildConfig.FAULT_HARNESS || !context.packageName.endsWith(".faulttest")) return
        val state = context.getSharedPreferences("fault-harness", Context.MODE_PRIVATE)
        if (state.getString("stopAt", "") != boundary) return
        check(state.edit().putString("reached", boundary).remove("stopAt").commit())
        Runtime.getRuntime().halt(86)
    }
}
