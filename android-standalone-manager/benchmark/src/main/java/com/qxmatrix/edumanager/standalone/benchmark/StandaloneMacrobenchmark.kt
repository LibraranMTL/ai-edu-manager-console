package com.qxmatrix.edumanager.standalone.benchmark

import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StandaloneMacrobenchmark {
    @get:Rule val rule = MacrobenchmarkRule()

    @Test fun coldStartup() = startup(StartupMode.COLD)
    @Test fun warmStartup() = startup(StartupMode.WARM)

    @Test fun foregroundNavigationWhileBackgroundWorkMayRun() = rule.measureRepeated(
        packageName = PACKAGE,
        metrics = listOf(FrameTimingMetric()),
        iterations = 5,
        compilationMode = CompilationMode.Partial(),
        setupBlock = { pressHome(); startActivityAndWait() },
    ) {
        device.findObject(By.textContains("资料"))?.click()
        device.waitForIdle()
        device.findObject(By.textContains("项目"))?.click()
        device.waitForIdle()
    }

    private fun startup(mode: StartupMode) = rule.measureRepeated(
        packageName = PACKAGE,
        metrics = listOf(StartupTimingMetric()),
        iterations = 10,
        startupMode = mode,
        compilationMode = CompilationMode.Partial(),
        setupBlock = { pressHome() },
    ) { startActivityAndWait() }

    companion object { private const val PACKAGE = "com.qxmatrix.edumanager.standalone" }
}
