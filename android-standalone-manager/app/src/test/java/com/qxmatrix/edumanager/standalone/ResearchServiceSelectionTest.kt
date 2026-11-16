package com.qxmatrix.edumanager.standalone

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ResearchServiceSelectionTest {
    @Test fun freshInstallUsesMainServiceAndExplicitChoiceIsRetained() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("research-service-selection", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("local_research", Context.MODE_PRIVATE).edit().clear().commit()
        assertFalse(ResearchServiceSelection.separate(context))
        ResearchServiceSelection.select(context, true)
        assertTrue(ResearchServiceSelection.separate(context))
        ResearchServiceSelection.select(context, false)
        assertFalse(ResearchServiceSelection.separate(context))
    }

    @Test fun legacySeparateProfileKeepsItsRouteUntilUserChangesIt() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("research-service-selection", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("local_research", Context.MODE_PRIVATE).edit()
            .putString("endpoint", "https://dashscope.aliyuncs.com/compatible-mode/v1").putString("model", "example").commit()
        assertTrue(ResearchServiceSelection.separate(context))
        ResearchServiceSelection.select(context, false)
        assertFalse(ResearchServiceSelection.separate(context))
    }
}
