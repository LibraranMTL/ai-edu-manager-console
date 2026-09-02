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
    val card: Int,
    val heading: Int,
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
        UiSkin.PURPLE -> UiPalette(Color.rgb(139, 92, 246), Color.rgb(109, 40, 217), Color.rgb(31, 29, 58), Color.rgb(10, 17, 36), Color.rgb(248, 250, 252), Color.rgb(183, 195, 216), Color.rgb(64, 61, 103), Color.rgb(22, 29, 54), Color.rgb(196, 181, 253))
        UiSkin.PINK -> UiPalette(Color.rgb(236, 72, 153), Color.rgb(190, 24, 93), Color.rgb(48, 25, 48), Color.rgb(22, 14, 31), Color.rgb(255, 248, 252), Color.rgb(216, 188, 207), Color.rgb(91, 47, 76), Color.rgb(39, 22, 43), Color.rgb(249, 168, 212))
        UiSkin.GREEN -> UiPalette(Color.rgb(38, 166, 106), Color.rgb(8, 114, 69), Color.rgb(15, 44, 42), Color.rgb(7, 25, 29), Color.rgb(246, 252, 250), Color.rgb(175, 205, 198), Color.rgb(42, 83, 76), Color.rgb(15, 41, 42), Color.rgb(110, 231, 183))
        UiSkin.BLUE -> UiPalette(Color.rgb(55, 118, 232), Color.rgb(29, 78, 216), Color.rgb(17, 39, 69), Color.rgb(6, 20, 43), Color.rgb(248, 250, 255), Color.rgb(176, 197, 224), Color.rgb(42, 76, 115), Color.rgb(15, 35, 64), Color.rgb(147, 197, 253))
        UiSkin.ORANGE -> UiPalette(Color.rgb(249, 115, 22), Color.rgb(194, 65, 12), Color.rgb(48, 31, 23), Color.rgb(27, 17, 12), Color.rgb(255, 250, 246), Color.rgb(221, 195, 177), Color.rgb(104, 66, 48), Color.rgb(45, 28, 20), Color.rgb(253, 186, 116))
    }

    companion object {
        private const val KEY_SKIN = "skin"
        private const val KEY_LAYOUT = "layout"
    }
}
