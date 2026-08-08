package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.util.AtomicFile
import java.io.File

/** Atomic storage for indexes and runtime state that must not be exposed through SAF. */
class PrivateStateStore(context: Context) {
    private val root = File(context.filesDir, "education-manager-state")

    fun writeBytes(relativePath: String, bytes: ByteArray) {
        val file = resolve(relativePath)
        check(file.parentFile?.mkdirs() == true || file.parentFile?.isDirectory == true) {
            "Unable to create private state directory"
        }
        val atomic = AtomicFile(file)
        val stream = atomic.startWrite()
        try {
            stream.write(bytes)
            stream.flush()
            atomic.finishWrite(stream)
        } catch (error: Throwable) {
            atomic.failWrite(stream)
            throw error
        }
    }

    fun readBytes(relativePath: String): ByteArray = AtomicFile(resolve(relativePath)).openRead().use { it.readBytes() }

    private fun resolve(relativePath: String): File =
        WorkspacePath.segments(relativePath).fold(root) { current, segment -> File(current, segment) }
}
