package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.net.Uri
import org.json.JSONObject
import org.w3c.dom.Element
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream
import javax.xml.parsers.DocumentBuilderFactory

data class OfficeParsedDocument(val kind: String, val text: String, val partCount: Int)

/** Bounded, read-only parser for non-macro OpenXML documents. Binary Office files fail closed. */
object OfficeOpenXmlParser {
    const val MAX_ARCHIVE_BYTES = 20_000_000
    private const val MAX_EXPANDED_BYTES = 60_000_000L
    private const val MAX_ENTRY_BYTES = 8_000_000
    private const val MAX_ENTRIES = 2_000
    private const val MAX_TEXT_CHARS = 200_000

    fun supports(name: String): Boolean = extension(name) in setOf("docx", "pptx", "xlsx")

    fun parse(name: String, bytes: ByteArray): OfficeParsedDocument {
        require(bytes.isNotEmpty() && bytes.size <= MAX_ARCHIVE_BYTES) { "Office 文档须在 20 MB 以内" }
        require(bytes.size >= 4 && bytes[0] == 0x50.toByte() && bytes[1] == 0x4b.toByte()) { "不是有效的 OpenXML 文档" }
        val extension = extension(name)
        require(extension in setOf("docx", "pptx", "xlsx")) { "只支持 DOCX、PPTX 和 XLSX；旧版二进制 Office 文件需另存为 OpenXML" }
        val entries = readEntries(bytes)
        require("[Content_Types].xml" in entries) { "OpenXML 文档缺少内容类型清单" }
        require(entries.keys.none { it.endsWith("vbaProject.bin", true) }) { "不解析含宏的 Office 文档" }
        return when (extension) {
            "docx" -> parseDocx(entries)
            "pptx" -> parsePptx(entries)
            else -> parseXlsx(entries)
        }.also { require(it.text.isNotBlank()) { "Office 文档没有可消化的正文" } }
    }

    private fun readEntries(bytes: ByteArray): Map<String, ByteArray> {
        val result = linkedMapOf<String, ByteArray>()
        var count = 0
        var expanded = 0L
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                require(++count <= MAX_ENTRIES) { "Office 文档条目过多" }
                val name = entry.name.replace('\\', '/')
                require(name.isNotBlank() && !name.startsWith('/') && name.split('/').none { it == ".." }) { "Office 文档包含不安全路径" }
                require(!entry.isDirectory)
                val buffer = ByteArray(8_192)
                val out = java.io.ByteArrayOutputStream()
                while (true) {
                    val read = zip.read(buffer)
                    if (read < 0) break
                    expanded += read
                    require(expanded <= MAX_EXPANDED_BYTES && out.size() + read <= MAX_ENTRY_BYTES) { "Office 文档展开后过大" }
                    out.write(buffer, 0, read)
                }
                result[name] = out.toByteArray()
            }
        }
        return result
    }

    private fun parseDocx(entries: Map<String, ByteArray>): OfficeParsedDocument {
        val parts = entries.keys.filter { it == "word/document.xml" || Regex("word/(header|footer)\\d+\\.xml").matches(it) }.sorted()
        require("word/document.xml" in parts) { "不是有效的 DOCX 文件" }
        return OfficeParsedDocument("docx", parts.mapIndexedNotNull { index, name ->
            xmlTexts(entries.getValue(name), setOf("t", "tab", "br", "cr")).takeIf(String::isNotBlank)?.let {
                if (index == 0) it else "## ${name.substringAfterLast('/')}\n\n$it"
            }
        }.joinToString("\n\n").take(MAX_TEXT_CHARS), parts.size)
    }

    private fun parsePptx(entries: Map<String, ByteArray>): OfficeParsedDocument {
        val slides = entries.keys.filter { Regex("ppt/slides/slide\\d+\\.xml").matches(it) }
            .sortedBy { it.substringAfter("slide").substringBefore('.').toIntOrNull() ?: Int.MAX_VALUE }
        require(slides.isNotEmpty()) { "不是有效的 PPTX 文件" }
        val text = slides.mapIndexedNotNull { index, name ->
            xmlTexts(entries.getValue(name), setOf("t")).takeIf(String::isNotBlank)?.let { "## 第 ${index + 1} 页\n\n$it" }
        }.joinToString("\n\n")
        return OfficeParsedDocument("pptx", text.take(MAX_TEXT_CHARS), slides.size)
    }

    private fun parseXlsx(entries: Map<String, ByteArray>): OfficeParsedDocument {
        val sheets = entries.keys.filter { Regex("xl/worksheets/sheet\\d+\\.xml").matches(it) }
            .sortedBy { it.substringAfter("sheet").substringBefore('.').toIntOrNull() ?: Int.MAX_VALUE }
        require(sheets.isNotEmpty()) { "不是有效的 XLSX 文件" }
        val shared = entries["xl/sharedStrings.xml"]?.let { xmlTextValues(it, "si") }.orEmpty()
        val sections = sheets.mapIndexedNotNull { index, name ->
            val document = xml(entries.getValue(name))
            val cells = document.getElementsByTagNameNS("*", "c")
            val lines = mutableListOf<String>()
            for (cellIndex in 0 until cells.length) {
                val cell = cells.item(cellIndex) as? Element ?: continue
                val reference = cell.getAttribute("r").ifBlank { "cell-${cellIndex + 1}" }
                val type = cell.getAttribute("t")
                val value = descendants(cell, if (type == "inlineStr") "t" else "v").firstOrNull().orEmpty()
                val resolved = if (type == "s") shared.getOrNull(value.toIntOrNull() ?: -1).orEmpty() else value
                if (resolved.isNotBlank()) lines += "$reference\t${resolved.trim()}"
                if (lines.joinToString("\n").length >= MAX_TEXT_CHARS) break
            }
            lines.takeIf { it.isNotEmpty() }?.joinToString("\n")?.let { "## 工作表 ${index + 1}\n\n$it" }
        }
        return OfficeParsedDocument("xlsx", sections.joinToString("\n\n").take(MAX_TEXT_CHARS), sheets.size)
    }

    private fun xmlTexts(bytes: ByteArray, names: Set<String>): String {
        val document = xml(bytes)
        val values = mutableListOf<String>()
        names.forEach { name ->
            val nodes = document.getElementsByTagNameNS("*", name)
            for (index in 0 until nodes.length) {
                val value = when (name) { "tab" -> "\t"; "br", "cr" -> "\n"; else -> nodes.item(index).textContent }
                if (value.isNotBlank()) values += value.trim()
            }
        }
        return values.joinToString("\n").replace(Regex("\n{3,}"), "\n\n")
    }

    private fun xmlTextValues(bytes: ByteArray, container: String): List<String> {
        val nodes = xml(bytes).getElementsByTagNameNS("*", container)
        return (0 until nodes.length).map { index -> descendants(nodes.item(index) as Element, "t").joinToString("") }
    }

    private fun descendants(element: Element, name: String): List<String> {
        val nodes = element.getElementsByTagNameNS("*", name)
        return (0 until nodes.length).map { nodes.item(it).textContent }
    }

    private fun xml(bytes: ByteArray) = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        setFeature("http://xml.org/sax/features/external-general-entities", false)
        setFeature("http://xml.org/sax/features/external-parameter-entities", false)
        setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false)
        runCatching { setAttribute("http://javax.xml.XMLConstants/property/accessExternalDTD", "") }
        runCatching { setAttribute("http://javax.xml.XMLConstants/property/accessExternalSchema", "") }
        isXIncludeAware = false
        isExpandEntityReferences = false
    }.newDocumentBuilder().parse(ByteArrayInputStream(bytes))

    private fun extension(name: String) = name.substringAfterLast('.', "").lowercase()
}

class OfficeDocumentParserService(private val context: Context) {
    fun parse(studentId: String, materialId: String): JSONObject = synchronized(StudentWorkLocks.forStudent(studentId)) {
        val student = StudentIndexRepository(context).requireExact(studentId)
        val files = FileAssetService(context)
        val material = files.materials(studentId).single { it.getString("id") == materialId }
        val bytes = files.readMaterialBytes(studentId, materialId, OfficeOpenXmlParser.MAX_ARCHIVE_BYTES)
        val sourceHash = ScopedContentPolicy.hash(bytes)
        val parsed = OfficeOpenXmlParser.parse(material.getString("fileName"), bytes)
        val key = ScopedContentPolicy.hash("$sourceHash:${parsed.kind}:office-openxml-v1".toByteArray())
        val result = JSONObject().put("schema", "edu-manager.office-extraction.v1")
            .put("text", parsed.text).put("digestText", parsed.text).put("sourceSha256", sourceHash)
            .put("parser", "office-openxml-v1").put("documentKind", parsed.kind).put("partCount", parsed.partCount)
            .put("evidenceStatus", "machine_observed").put("reviewStatus", "pending_review").put("createdAt", Timestamp.now())
        require(ScopedContentPolicy.hash(files.readMaterialBytes(studentId, materialId, OfficeOpenXmlParser.MAX_ARCHIVE_BYTES)) == sourceHash) {
            "Office 原件已变化，解析结果未发布"
        }
        val store = SafWorkspaceStore(context, Uri.parse(student.storageRootUri))
        val path = "${student.paths.summaryPath}/摘要库/Office解析-$key.json"
        val markdown = "${student.paths.summaryPath}/摘要库/Office解析-$key.md"
        store.writeBytesSafely(path, (result.toString(2) + "\n").toByteArray(), "application/json")
        store.writeBytesSafely(markdown, ("# Office 解析候选\n\n机器观察／待审核；不是学习掌握结论。\n来源 $materialId · SHA256 $sourceHash\n\n${parsed.text}\n").toByteArray(), "text/markdown")
        files.patchMaterial(studentId, materialId, JSONObject().put("ocrStatus", "completed").put("ocrPath", path)
            .put("ocrMarkdownPath", markdown).put("digestReady", true).put("digestInputKind", "office_openxml")
            .put("parserVersion", "office-openxml-v1").put("parserReviewStatus", "pending_review"))
        AutomationEventEmitter.ocrResult(context, studentId, material, result)
        result
    }
}
