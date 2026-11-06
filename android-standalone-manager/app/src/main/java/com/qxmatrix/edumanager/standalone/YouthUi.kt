package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.InsetDrawable
import android.graphics.drawable.StateListDrawable
import android.text.TextUtils
import android.util.StateSet
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.TextView

enum class YouthButtonRole {
    PRIMARY,
    SECONDARY,
    NAVIGATION,
    NAVIGATION_ACTIVE,
    COMPACT,
    DANGER,
}

/**
 * A small, dependency-free visual system for the standalone tablet app.
 * It keeps the existing programmatic View architecture while giving every
 * action a consistent touch target, rounded shape, focus state and press state.
 */
object YouthUi {
    private val learningCardColors = listOf(
        intArrayOf(Color.rgb(37, 99, 235), Color.rgb(29, 78, 216)),
        intArrayOf(Color.rgb(14, 116, 144), Color.rgb(8, 89, 113)),
        intArrayOf(Color.rgb(194, 65, 12), Color.rgb(154, 52, 18)),
        intArrayOf(Color.rgb(124, 58, 237), Color.rgb(91, 33, 182)),
        intArrayOf(Color.rgb(219, 39, 119), Color.rgb(157, 23, 77)),
        intArrayOf(Color.rgb(21, 128, 61), Color.rgb(22, 101, 52)),
    )

    fun applyButton(
        button: Button,
        palette: UiPalette,
        role: YouthButtonRole = YouthButtonRole.SECONDARY,
    ) {
        val context = button.context
        val compact = role in setOf(YouthButtonRole.COMPACT, YouthButtonRole.NAVIGATION, YouthButtonRole.NAVIGATION_ACTIVE)
        val radius = dp(context, if (compact) 18 else 22).toFloat()
        val inset = dp(context, if (compact) 2 else 4)
        val colors = when (role) {
            YouthButtonRole.PRIMARY, YouthButtonRole.NAVIGATION_ACTIVE -> intArrayOf(palette.accent, palette.accentDark)
            YouthButtonRole.DANGER -> intArrayOf(Color.rgb(239, 68, 68), Color.rgb(190, 24, 93))
            YouthButtonRole.SECONDARY, YouthButtonRole.COMPACT -> intArrayOf(
                mix(palette.card, palette.accentSoft, 0.18f),
                mix(palette.card, palette.accentSoft, 0.48f),
            )
            YouthButtonRole.NAVIGATION -> intArrayOf(
                withAlpha(palette.card, 226),
                withAlpha(palette.accentSoft, 224),
            )
        }
        val border = when (role) {
            YouthButtonRole.PRIMARY, YouthButtonRole.NAVIGATION_ACTIVE -> mix(palette.accent, Color.WHITE, 0.30f)
            YouthButtonRole.DANGER -> Color.rgb(254, 202, 202)
            else -> palette.border
        }
        val pressed = colors.map { mix(it, Color.BLACK, 0.10f) }.toIntArray()
        val focused = colors.map { mix(it, palette.accent, 0.18f) }.toIntArray()
        val disabled = colors.map { mix(it, palette.page, 0.62f) }.toIntArray()
        val states = StateListDrawable().apply {
            addState(intArrayOf(-android.R.attr.state_enabled), gradient(disabled, radius, mix(border, palette.page, 0.55f), 1, context))
            addState(intArrayOf(android.R.attr.state_pressed), gradient(pressed, radius, border, 1, context))
            addState(intArrayOf(android.R.attr.state_focused), gradient(focused, radius, palette.accent, 2, context))
            addState(StateSet.WILD_CARD, gradient(colors, radius, border, 1, context))
        }
        button.backgroundTintList = null
        button.background = InsetDrawable(states, 0, inset, 0, inset)
        button.setTextColor(
            ColorStateList(
                arrayOf(intArrayOf(-android.R.attr.state_enabled), StateSet.WILD_CARD),
                intArrayOf(
                    withAlpha(if (role.isHighContrast()) Color.WHITE else palette.muted, 150),
                    if (role.isHighContrast()) Color.WHITE else palette.text,
                ),
            ),
        )
        button.isAllCaps = false
        if (button.contentDescription.isNullOrBlank()) button.contentDescription = button.text
        button.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        button.textSize = if (compact) 15f else 16f
        button.typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        button.letterSpacing = 0.015f
        button.gravity = if (role in setOf(YouthButtonRole.SECONDARY, YouthButtonRole.NAVIGATION)) {
            Gravity.START or Gravity.CENTER_VERTICAL
        } else {
            Gravity.CENTER
        }
        button.textAlignment = if (button.gravity and Gravity.START == Gravity.START) View.TEXT_ALIGNMENT_VIEW_START else View.TEXT_ALIGNMENT_CENTER
        button.minHeight = dp(context, if (compact) 52 else 62)
        button.minimumWidth = 0
        button.setPadding(dp(context, if (compact) 16 else 20), dp(context, 8), dp(context, if (compact) 16 else 20), dp(context, 8))
        button.maxLines = 2
        button.ellipsize = TextUtils.TruncateAt.END
        button.elevation = dp(context, if (role.isHighContrast()) 4 else 2).toFloat()
        button.stateListAnimator = null
    }

    fun applyStatusCard(view: View, palette: UiPalette) {
        view.background = gradient(
            intArrayOf(withAlpha(palette.card, 248), mix(palette.card, palette.accentSoft, 0.24f)),
            dp(view.context, 20).toFloat(),
            withAlpha(palette.border, 220),
            1,
            view.context,
        )
        view.elevation = dp(view.context, 2).toFloat()
    }

    fun applyExpertCard(view: View, palette: UiPalette) {
        val ivory = Color.rgb(255, 250, 235)
        val warm = Color.rgb(255, 244, 214)
        view.background = gradient(
            intArrayOf(mix(ivory, palette.card, 0.16f), mix(warm, palette.accentSoft, 0.10f)),
            dp(view.context, 26).toFloat(),
            Color.rgb(235, 190, 94),
            1,
            view.context,
        )
        view.elevation = dp(view.context, 5).toFloat()
    }

    fun applyBadge(view: View, palette: UiPalette, onColor: Boolean) {
        val fill = if (onColor) withAlpha(Color.BLACK, 42) else mix(palette.accentSoft, palette.card, 0.24f)
        val border = if (onColor) withAlpha(Color.WHITE, 118) else palette.border
        view.background = gradient(
            intArrayOf(fill, fill),
            dp(view.context, 14).toFloat(),
            border,
            1,
            view.context,
        )
    }

    fun applyIconTile(view: View, palette: UiPalette, onColor: Boolean) {
        val fill = if (onColor) withAlpha(Color.WHITE, 34) else mix(palette.accentSoft, palette.card, 0.32f)
        val border = if (onColor) withAlpha(Color.WHITE, 112) else palette.border
        view.background = gradient(
            intArrayOf(fill, fill),
            dp(view.context, 16).toFloat(),
            border,
            1,
            view.context,
        )
    }

    fun applyDecorativeOrb(view: View) {
        view.background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(withAlpha(Color.WHITE, 24))
        }
    }

    fun applyTitleBanner(view: TextView, palette: UiPalette) {
        view.background = gradient(
            intArrayOf(mix(palette.card, palette.accentSoft, 0.42f), withAlpha(palette.card, 246)),
            dp(view.context, 24).toFloat(),
            palette.border,
            1,
            view.context,
        )
        view.setPadding(dp(view.context, 20), dp(view.context, 14), dp(view.context, 20), dp(view.context, 14))
        view.elevation = dp(view.context, 2).toFloat()
        view.typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }

    fun applyLearningCard(view: View, index: Int) {
        val context = view.context
        val colors = learningCardColors[index.mod(learningCardColors.size)]
        val pressed = colors.map { mix(it, Color.BLACK, 0.12f) }.toIntArray()
        val radius = dp(context, 26).toFloat()
        view.background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_pressed), gradient(pressed, radius, mix(colors[0], Color.WHITE, 0.32f), 1, context))
            addState(intArrayOf(android.R.attr.state_focused), gradient(colors, radius, Color.WHITE, 2, context))
            addState(StateSet.WILD_CARD, gradient(colors, radius, mix(colors[0], Color.WHITE, 0.34f), 1, context))
        }
        view.elevation = dp(context, 5).toFloat()
    }

    fun applySurface(view: View, palette: UiPalette, radiusDp: Int = 20) {
        view.background = gradient(
            intArrayOf(palette.card, mix(palette.card, palette.accentSoft, 0.16f)),
            dp(view.context, radiusDp).toFloat(),
            palette.border,
            1,
            view.context,
        )
        view.elevation = dp(view.context, 2).toFloat()
    }

    private fun YouthButtonRole.isHighContrast() = this in setOf(
        YouthButtonRole.PRIMARY,
        YouthButtonRole.NAVIGATION_ACTIVE,
        YouthButtonRole.DANGER,
    )

    private fun gradient(
        colors: IntArray,
        radius: Float,
        strokeColor: Int,
        strokeDp: Int,
        context: Context,
    ) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, colors).apply {
        cornerRadius = radius
        setStroke(dp(context, strokeDp), strokeColor)
    }

    private fun mix(first: Int, second: Int, ratio: Float): Int {
        val safe = ratio.coerceIn(0f, 1f)
        return Color.argb(
            (Color.alpha(first) * (1f - safe) + Color.alpha(second) * safe).toInt(),
            (Color.red(first) * (1f - safe) + Color.red(second) * safe).toInt(),
            (Color.green(first) * (1f - safe) + Color.green(second) * safe).toInt(),
            (Color.blue(first) * (1f - safe) + Color.blue(second) * safe).toInt(),
        )
    }

    private fun withAlpha(color: Int, alpha: Int) = Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
    private fun dp(context: Context, value: Int) = (value * context.resources.displayMetrics.density).toInt()
}
