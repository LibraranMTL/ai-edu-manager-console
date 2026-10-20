package com.qxmatrix.edumanager.standalone

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.zip.ZipInputStream

object AnswerFilePolicy {
    const val MAX_BYTES = 20_000_000
    fun validate(name: String, bytes: ByteArray): String {
        require(bytes.isNotEmpty() && bytes.size <= MAX_BYTES) { "作答文件须在 20 MB 以内" }
        val ext = name.substringAfterLast('.', "").lowercase()
        fun starts(vararg values: Int) = bytes.size >= values.size && values.indices.all { (bytes[it].toInt() and 255) == values[it] }
        return when (ext) {
            "pdf" -> { require(starts(0x25, 0x50, 0x44, 0x46, 0x2D)); "application/pdf" }
            "png" -> { require(starts(137, 80, 78, 71, 13, 10, 26, 10)); "image/png" }
            "jpg", "jpeg" -> { require(starts(255, 216, 255)); "image/jpeg" }
            "docx" -> {
                require(starts(80, 75, 3, 4))
                var types = false; var document = false; var count = 0; var expanded = 0L
                ZipInputStream(bytes.inputStream()).use { zip ->
                    val buffer = ByteArray(8_192)
                    while (true) {
                        val entry = zip.nextEntry ?: break
                        require(++count <= 2_000 && !entry.name.startsWith('/') && entry.name.split('/').none { it == ".." })
                        require(!entry.name.endsWith("vbaProject.bin", true)) { "不接受宏文件" }
                        if (entry.name == "[Content_Types].xml") types = true
                        if (entry.name == "word/document.xml") document = true
                        while (true) { val n = zip.read(buffer); if (n < 0) break; expanded += n; require(expanded <= 40_000_000) { "压缩包展开过大" } }
                    }
                }
                require(types && document) { "不是有效的 DOCX 文件" }; "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            }
            "md", "txt" -> {
                require(bytes.none { it == 0.toByte() })
                Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes))
                "text/plain"
            }
            else -> error("支持 TXT、Markdown、图片、PDF 和 DOCX；不接受可执行文件")
        }
    }
}
