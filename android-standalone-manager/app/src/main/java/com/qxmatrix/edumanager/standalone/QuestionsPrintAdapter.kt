package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.graphics.Paint
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.*
import android.print.pdf.PrintedPdfDocument
import org.json.JSONObject
import java.io.FileOutputStream

/** Only accepts a cards payload and derives a questions-only immutable print snapshot. */
class QuestionsPrintAdapter(private val context: Context, payload: JSONObject) : PrintDocumentAdapter() {
    private val content = LearningStudioPolicy.questionsOnly(payload)
    private var attributes: PrintAttributes? = null
    private var lines = emptyList<String>()
    private var linesPerPage = 1
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 12f; color = android.graphics.Color.BLACK }
    override fun onLayout(oldAttributes: PrintAttributes?, newAttributes: PrintAttributes, cancellationSignal: CancellationSignal,
        callback: LayoutResultCallback, extras: Bundle?) {
        if (cancellationSignal.isCanceled) { callback.onLayoutCancelled(); return }
        attributes = newAttributes
        val pdf = PrintedPdfDocument(context, newAttributes)
        try {
            val area = pdf.pageContentRect
            linesPerPage = ((area.height() - 32) / 18).coerceAtLeast(1)
            lines = content.split('\n').flatMap { paragraph ->
                val output = mutableListOf<String>(); var start = 0
                while (start < paragraph.length) {
                    val count = paint.breakText(paragraph, start, paragraph.length, true, (area.width() - 8).toFloat().coerceAtLeast(12f), null).coerceAtLeast(1)
                    output += paragraph.substring(start, start + count); start += count
                }
                if (output.isEmpty()) listOf("") else output
            }
            callback.onLayoutFinished(PrintDocumentInfo.Builder("学习练习.pdf").setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount((lines.size + linesPerPage - 1) / linesPerPage).build(), oldAttributes != newAttributes)
        } catch (error: Exception) { callback.onLayoutFailed(error.message) } finally { pdf.close() }
    }
    override fun onWrite(pages: Array<out PageRange>, destination: ParcelFileDescriptor, cancellationSignal: CancellationSignal, callback: WriteResultCallback) {
        val pdf = PrintedPdfDocument(context, requireNotNull(attributes))
        val written = mutableListOf<PageRange>()
        try {
            val count = (lines.size + linesPerPage - 1) / linesPerPage
            for (index in 0 until count) {
                if (cancellationSignal.isCanceled) { callback.onWriteCancelled(); return }
                if (pages.none { index in it.start..it.end }) continue
                val page = pdf.startPage(index)
                lines.drop(index * linesPerPage).take(linesPerPage).forEachIndexed { line, text -> page.canvas.drawText(text, 4f, 18f + line * 18, paint) }
                pdf.finishPage(page); written += PageRange(index, index)
            }
            FileOutputStream(destination.fileDescriptor).use { pdf.writeTo(it) }
            callback.onWriteFinished(written.toTypedArray())
        } catch (error: Exception) { callback.onWriteFailed(error.message) } finally { pdf.close() }
    }
}
