package com.qxmatrix.edumanager.standalone

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.TimeUnit

class ModelCrashProcessTest {
    @get:Rule val temp = TemporaryFolder()

    @Test fun processTerminationAfterCheckpointLeavesOneSendAndNoSuccessReceipt() {
        val entries = listOf(ModelCrashProcessFixture::class.java, CompatibleModelProvider::class.java,
            JSONObject::class.java, kotlin.Unit::class.java).mapNotNull { it.protectionDomain?.codeSource?.location }
            .map { File(it.toURI()).absolutePath }
        val classpath = (listOf(System.getProperty("java.class.path")) + entries).distinct().joinToString(File.pathSeparator)
        val java = File(System.getProperty("java.home"), "bin/java.exe")
        val executable = if (java.exists()) java else File(System.getProperty("java.home"), "bin/java")
        val process = ProcessBuilder(executable.absolutePath, "-cp", classpath,
            ModelCrashProcessFixture::class.java.name, temp.root.absolutePath).redirectErrorStream(true).start()
        assertTrue("child process did not exit", process.waitFor(30, TimeUnit.SECONDS))
        val output = process.inputStream.bufferedReader().readText()
        assertEquals(output, 23, process.exitValue())
        assertEquals("synthetic-result", File(temp.root, "checkpoint.txt").readText())
        assertEquals(listOf("sent"), File(temp.root, "sends.txt").readLines())
        assertEquals(listOf("running"), File(temp.root, "receipts.txt").readLines())
    }
}
