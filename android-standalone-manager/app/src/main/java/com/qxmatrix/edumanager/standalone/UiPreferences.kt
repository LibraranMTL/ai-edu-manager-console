package com.qxmatrix.edumanager.standalone

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.graphics.Color

enum class UiSkin(val wireValue: String, val label: String) {
    PURPLE("purple", "紫色"),
    PINK("pink", "粉色"),
    GREEN("green", "绿色"),
    BLUE("blue", "蓝色"),
    ORANGE("orange", "橙色");

    companion object {
        fun from(value: String?): UiSkin = entries.firstOrNull { it.wireValue == value } ?: GREEN
    }

    fun backgroundResource(): Int = when (this) {
        PURPLE -> R.drawable.skin_purple
        PINK -> R.drawable.skin_pink
        GREEN -> R.drawable.skin_green
        BLUE -> R.drawable.skin_blue
        ORANGE -> R.drawable.skin_orange
    }
}

enum class UiLayoutMode(val wireValue: String, val label: String) {
    LANDSCAPE("landscape", "横屏"),
    PORTRAIT("portrait", "竖屏"),
    ADAPTIVE("adaptive", "自适应");

    companion object {
        fun from(value: String?): UiLayoutMode = entries.firstOrNull { it.wireValue == value } ?: ADAPTIVE
    }
}

data class UiPalette(
    val accent: Int,
    val accentDark: Int,
    val accentSoft: Int,
    val page: Int,
    val text: Int,
    val muted: Int,
    val border: Int,
    val card: Int = Color.WHITE,
)

class UiPreferences(context: Context) {
    private val values = context.applicationContext.getSharedPreferences("standalone_ui", Context.MODE_PRIVATE)

    fun skin(): UiSkin = UiSkin.from(values.getString(KEY_SKIN, null))
    fun layoutMode(): UiLayoutMode = UiLayoutMode.from(values.getString(KEY_LAYOUT, null))
    fun setSkin(value: UiSkin) { check(values.edit().putString(KEY_SKIN, value.wireValue).commit()) }
    fun setLayoutMode(value: UiLayoutMode) { check(values.edit().putString(KEY_LAYOUT, value.wireValue).commit()) }

    fun applyOrientation(activity: Activity) {
        activity.requestedOrientation = when (layoutMode()) {
            UiLayoutMode.LANDSCAPE -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            UiLayoutMode.PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            UiLayoutMode.ADAPTIVE -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    fun palette(): UiPalette = when (skin()) {
        UiSkin.PURPLE -> UiPalette(Color.rgb(139, 92, 246), Color.rgb(109, 40, 217), Color.rgb(240, 233, 255), Color.rgb(251, 249, 255), Color.rgb(49, 39, 70), Color.rgb(101, 84, 126), Color.rgb(212, 194, 255))
        UiSkin.PINK -> UiPalette(Color.rgb(236, 72, 153), Color.rgb(190, 24, 93), Color.rgb(253, 231, 242), Color.rgb(255, 248, 251), Color.rgb(76, 35, 55), Color.rgb(130, 76, 102), Color.rgb(249, 184, 213))
        UiSkin.GREEN -> UiPalette(Color.rgb(38, 166, 106), Color.rgb(8, 114, 69), Color.rgb(232, 248, 239), Color.rgb(247, 252, 249), Color.rgb(38, 57, 54), Color.rgb(87, 107, 103), Color.rgb(185, 232, 207))
        UiSkin.BLUE -> UiPalette(Color.rgb(55, 118, 232), Color.rgb(29, 78, 216), Color.rgb(231, 240, 255), Color.rgb(247, 250, 255), Color.rgb(35, 49, 76), Color.rgb(82, 101, 137), Color.rgb(185, 207, 248))
        UiSkin.ORANGE -> UiPalette(Color.rgb(249, 115, 22), Color.rgb(194, 65, 12), Color.rgb(255, 240, 223), Color.rgb(255, 250, 244), Color.rgb(75, 49, 31), Color.rgb(130, 91, 62), Color.rgb(254, 208, 164))
    }

    companion object {
        private const val KEY_SKIN = "skin"
        private const val KEY_LAYOUT = "layout"
    }
}
