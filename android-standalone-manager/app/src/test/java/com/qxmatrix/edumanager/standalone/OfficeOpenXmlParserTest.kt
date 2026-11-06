package com.qxmatrix.edumanager.standalone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class OfficeOpenXmlParserTest {
    @Test fun parses_docx_text_without_external_content() {
        val parsed = OfficeOpenXmlParser.parse("notes.docx", archive(mapOf(
            "[Content_Types].xml" to "<Types/>",
            "word/document.xml" to "<w:document xmlns:w=\"urn:w\"><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>",
        )))
        assertEquals("docx", parsed.kind)
        assertTrue(parsed.text.contains("第一段"))
        assertTrue(parsed.text.contains("Second"))
    }

    @Test fun parses_pptx_and_xlsx() {
        val ppt = OfficeOpenXmlParser.parse("slides.pptx", archive(mapOf(
            "[Content_Types].xml" to "<Types/>",
            "ppt/slides/slide1.xml" to "<p:sld xmlns:p=\"urn:p\" xmlns:a=\"urn:a\"><a:t>核心概念</a:t></p:sld>",
        )))
        assertTrue(ppt.text.contains("第 1 页")); assertTrue(ppt.text.contains("核心概念"))

        val xlsx = OfficeOpenXmlParser.parse("table.xlsx", archive(mapOf(
            "[Content_Types].xml" to "<Types/>",
            "xl/sharedStrings.xml" to "<sst xmlns=\"urn:x\"><si><t>知识点</t></si></sst>",
            "xl/worksheets/sheet1.xml" to "<worksheet xmlns=\"urn:x\"><sheetData><row><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\"><v>42</v></c></row></sheetData></worksheet>",
        )))
        assertTrue(xlsx.text.contains("A1\t知识点")); assertTrue(xlsx.text.contains("B1\t42"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejects_macro_payload() {
        OfficeOpenXmlParser.parse("bad.docx", archive(mapOf(
            "[Content_Types].xml" to "<Types/>", "word/document.xml" to "<document/>",
            "word/vbaProject.bin" to "macro",
        )))
    }

    private fun archive(entries: Map<String, String>): ByteArray = ByteArrayOutputStream().also { output ->
        ZipOutputStream(output).use { zip -> entries.forEach { (name, value) ->
            zip.putNextEntry(ZipEntry(name)); zip.write(value.toByteArray()); zip.closeEntry()
        } }
    }.toByteArray()
}
