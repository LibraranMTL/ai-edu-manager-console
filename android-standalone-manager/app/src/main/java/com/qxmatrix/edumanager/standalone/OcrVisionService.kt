package com.qxmatrix.edumanager.standalone

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

class OcrVisionService(private val context: Context) {
    private val students = StudentIndexRepository(context)
    private val files = FileAssetService(context)
    private val tasks = TaskRepository(context)
    private val tools = ControlledFileTools(context)

    fun extract(studentId: String, materialId: String, includeVision: Boolean): JSONObject = synchronized(StudentWorkLocks.forStudent(studentId)) {
        val student = students.requireExact(studentId)
        val material = files.materials(studentId).singleOrNull { it.optString("id") == materialId } ?: error("未找到指定资料")
        val sourcePath = material.getString("absolutePath")
        val outputRoot = child(student.paths.rootPath, ".edu-manager/ocr")
        val outputPath = "$outputRoot/$materialId.json"
        val task = tasks.create(JSONObject().put("title", "${material.getString("fileName")} OCR/视觉解析").put("kind", "ocr_extract")
            .put("sourceType", "student").put("sourceId", student.id).put("sourceName", student.name).put("status", "pending").put("riskLevel", "low")
            .put("input", JSONObject().put("studentId", student.id).put("materialId", materialId).put("includeVision", includeVision))
            .put("expectedOutput", JSONObject().put("path", outputPath).put("format", "edu-manager.ocr-result.v1"))
            .put("permissions", JSONObject().put("read", JSONArray(listOf(sourcePath))).put("write", JSONArray(listOf(outputRoot)))
                .put("operations", JSONArray(listOf("read_file", "write_ocr_result") + if (includeVision) listOf("vision_analyze") else emptyList<String>()))))
        val running = tasks.start(task.getString("id")); val executionId = running.getString("executionId")
        try {
            files.patchMaterial(student.id, materialId, JSONObject()
                .put("ocrStatus", "running")
                .put("ocrError", "")
                .put("visionStatus", if (includeVision) "running" else material.optString("visionStatus", "not_requested"))
                .put("visionError", ""))
            val bytes = tools.readStudentFile(task.getString("id"), executionId, student.id, sourcePath)
            require(bytes.size <= 40_000_000) { "OCR 原件超过40 MB，请拆分" }
            val sourceHash = ScopedContentPolicy.hash(bytes)
            val checkpoints = ScopedContentRepository(context)
            val pages = JSONArray(); var visionCalls = 0
            val route = AgentConfigurationStore(context).publicProfile()
            fun processPage(index: Int, bitmap: Bitmap, recognize: () -> String): String {
                val key = "$materialId:$sourceHash:$index:mlkit-v1"
                val checkpoint = checkpoints.checkpoint(studentId, "ocr_page", key) ?: JSONObject()
                    .put("sourceSha256", sourceHash).put("page", index + 1).put("text", recognize()).put("processingVersion", "ocr-page-v1")
                    .put("evidenceStatus", "machine_observed").also { checkpoints.saveCheckpoint(studentId, "ocr_page", key, it) }
                var vision = ""; var error = ""; var state = "not_requested"
                if (includeVision) {
                    val visionKey = "$sourceHash:$index:${ScopedContentPolicy.hash("${route?.endpoint}:${route?.visionModel}".toByteArray())}"
                    val cached = checkpoints.checkpoint(studentId, "vision_page", visionKey)
                    val receiptId = "vision-page:${ScopedContentPolicy.hash(visionKey.toByteArray())}"
                    if (cached != null) { vision = cached.getString("text"); state = "completed" }
                    else if (BusinessDatabase.get(context).ledger().hasPossibleResult(studentId, receiptId)) { state = "needs_user"; error = "该页上次请求结果需核对，不自动重试" }
                    else if (visionCalls >= 3) { state = "waiting_quota"; error = "每次最多新增3页视觉请求；已完成页保留，可手动继续" }
                    else {
                        visionCalls++
                        val attempt = runCatching { analyzeVision("第${index + 1}页", previewJpeg(bitmap), studentId, receiptId) }
                        attempt.onSuccess { text ->
                            require(text.isNotBlank()); checkpoints.saveCheckpoint(studentId, "vision_page", visionKey,
                                JSONObject().put("sourceSha256", sourceHash).put("page", index + 1).put("text", text).put("evidenceStatus", "machine_observed"))
                            vision = text; state = "completed"
                        }.onFailure { state = "needs_user"; error = it.message ?: "未完成" }
                    }
                }
                pages.put(JSONObject().put("page", index + 1).put("sourceSha256", sourceHash).put("text", checkpoint.getString("text"))
                    .put("visionSummary", vision).put("visionStatus", state).put("error", error).put("evidenceStatus", "machine_observed"))
                return checkpoint.getString("text")
            }
            val extension = material.getString("fileName").substringAfterLast('.', "").lowercase()
            val extracted = when (extension) {
                "jpg", "jpeg", "png", "webp", "bmp" -> extractBitmap(decodeBounded(bytes), ::processPage)
                "pdf" -> extractPdf(bytes, ::processPage)
                else -> error("当前 OCR 支持图片和 PDF；Office 文档将在文件解析适配器中处理")
            }
            require(ScopedContentPolicy.hash(files.readMaterialBytes(studentId, materialId)) == sourceHash) { "原件已变化，拒绝迟到解析结果" }
            val pageObjects = (0 until pages.length()).map { pages.getJSONObject(it) }
            val vision = pageObjects.filter { it.optString("visionSummary").isNotBlank() }.joinToString("\n\n") { "第${it.getInt("page")}页：${it.getString("visionSummary")}" }
            val visionError = pageObjects.map { it.optString("error") }.filter(String::isNotBlank).distinct().joinToString("；")
            val visionStatus = when {
                !includeVision -> "not_requested"
                pageObjects.all { it.getString("visionStatus") == "completed" } -> "completed"
                else -> "unavailable"
            }
            val digestText = MaterialProcessingPolicy.digestInput(JSONObject()
                .put("text", extracted.text).put("visionSummary", vision))
            val digestReady = digestText.isNotBlank()
            val ocrStatus = if (digestReady) "completed" else "needs_user"
            val ocrError = if (digestReady) "" else "未识别到可消化内容，请重新拍摄清晰图片，或补充视觉解析后重试"
            val result = JSONObject().put("schema", "edu-manager.ocr-result.v1").put("studentId", student.id).put("materialId", materialId)
                .put("sourceSha1", material.getString("sha1")).put("ocrEngine", "mlkit-text-recognition-chinese-16.0.1")
                .put("sourceSha256", sourceHash).put("pages", pages).put("processingVersion", "ocr-page-v1").put("evidenceStatus", "machine_observed")
                .put("pageCount", extracted.pageCount).put("text", extracted.text).put("visionSummary", vision)
                .put("digestText", digestText).put("digestReady", digestReady)
                .put("digestInputKind", MaterialProcessingPolicy.inputKind(extracted.text, vision))
                .put("visionStatus", visionStatus).put("visionError", visionError.take(800))
                .put("visionRecoveryState", if (visionStatus == "unavailable") "needs_user" else visionStatus)
                .put("createdAt", Timestamp.now()).put("candidateOnly", true)
            tools.writeStudentFile(task.getString("id"), executionId, student.id, outputPath, (result.toString(2) + "\n").toByteArray(), "application/json", "write_ocr_result")
            val markdownPath = "$outputRoot/$materialId.md"
            val visionMarkdown = when {
                vision.isNotBlank() -> "## 视觉理解\n\n$vision\n"
                includeVision -> "## 视觉理解\n\n> 视觉模型未完成解析，本地 OCR 结果已保留。请在 Agent 配置中填写支持图片输入的视觉模型后重试。\n\n错误：${visionError.take(500)}\n"
                else -> ""
            }
            val markdown = "# ${material.getString("fileName")} OCR 结果\n\n> 机器提取候选，需结合原文件核对。\n\n## 识别文字\n\n${extracted.text}\n\n$visionMarkdown"
            tools.writeStudentFile(task.getString("id"), executionId, student.id, markdownPath, markdown.toByteArray(), "text/markdown", "write_ocr_result")
            files.patchMaterial(student.id, materialId, JSONObject().put("ocrStatus", ocrStatus).put("ocrError", ocrError)
                .put("ocrPath", outputPath).put("ocrMarkdownPath", markdownPath).put("digestReady", digestReady)
                .put("digestInputKind", MaterialProcessingPolicy.inputKind(extracted.text, vision))
                .put("visionStatus", visionStatus).put("visionError", visionError.take(800)))
            val message = when {
                !digestReady -> ocrError
                visionStatus == "unavailable" -> "本地逐页 OCR 已完成且可消化；部分视觉页等待额度或人工核对，已完成页保留"
                else -> "OCR/视觉解析完成"
            }
            tasks.acceptResult(task.getString("id"), resultPayload(task.getString("id"), executionId, digestReady, message, outputPath))
            JSONObject().put("ok", digestReady).put("message", message).put("task", tasks.requireExact(task.getString("id")))
                .put("result", result).put("outputPath", outputPath)
        } catch (error: Throwable) {
            files.patchMaterial(student.id, materialId, JSONObject().put("ocrStatus", "failed").put("ocrError", error.message ?: "解析失败"))
            runCatching { tasks.acceptResult(task.getString("id"), resultPayload(task.getString("id"), executionId, false, error.message ?: "解析失败", "")) }
            throw error
        }
    }

    private fun decodeBounded(bytes: ByteArray): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0)
        var sample = 1; while (bounds.outWidth / sample > 2048 || bounds.outHeight / sample > 2048) sample *= 2
        return requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }))
    }
    private fun extractBitmap(bitmap: Bitmap, process: (Int, Bitmap, () -> String) -> String): Extracted {
        val recognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        return try {
            val text = process(0, bitmap) { Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0))).text }
            Extracted(text, 1, previewJpeg(bitmap))
        } finally { recognizer.close(); bitmap.recycle() }
    }

    private fun extractPdf(bytes: ByteArray, process: (Int, Bitmap, () -> String) -> String): Extracted {
        val temporary = File.createTempFile("ocr-", ".pdf", context.cacheDir).apply { writeBytes(bytes) }
        val recognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        var preview = ByteArray(0)
        return try {
            ParcelFileDescriptor.open(temporary, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
                PdfRenderer(descriptor).use { renderer ->
                    require(renderer.pageCount <= MAX_PDF_PAGES) { "PDF 超过 $MAX_PDF_PAGES 页，请拆分后处理" }
                    val text = buildString {
                        for (index in 0 until renderer.pageCount) renderer.openPage(index).use { page ->
                            val scale = minOf(1600f / page.width, 2048f / page.height, 2f); val bitmap = Bitmap.createBitmap((page.width * scale).toInt().coerceAtLeast(1), (page.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
                            bitmap.eraseColor(android.graphics.Color.WHITE)
                            try {
                            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            if (index == 0) preview = previewJpeg(bitmap)
                            appendLine("\n## 第 ${index + 1} 页\n"); appendLine(process(index, bitmap) { Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0))).text })
                            } finally { bitmap.recycle() }
                        }
                    }
                    Extracted(text.trim(), renderer.pageCount, preview)
                }
            }
        } finally { recognizer.close(); temporary.delete() }
    }

    private fun analyzeVision(filename: String, previewJpeg: ByteArray, studentId: String, taskId: String): String {
        require(previewJpeg.isNotEmpty()) { "没有可用于视觉理解的页面" }
        val config = requireNotNull(AgentConfigurationStore(context).load()) { "尚未配置支持视觉输入的 Agent 模型" }
        return OpenAiCompatibleAgentAdapter(config, context, studentId, taskId).executeVision(
            "你是教育资料视觉理解工具，只描述页面中可观察到的内容，不推断学生身份、人格、能力或诊断。",
            "请描述学习资料《$filename》的版面、图表、题目结构和需要人工核对之处。不要形成正式教育结论。",
            previewJpeg, "image/jpeg")
    }

    private fun previewJpeg(bitmap: Bitmap): ByteArray {
        val scale = (1600f / bitmap.width).coerceAtMost(1f); val preview = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true) else bitmap
        return ByteArrayOutputStream().use { output -> preview.compress(Bitmap.CompressFormat.JPEG, 82, output); if (preview !== bitmap) preview.recycle(); output.toByteArray() }
    }

    private fun resultPayload(taskId: String, executionId: String, passed: Boolean, message: String, path: String) = JSONObject()
        .put("protocolVersion", TaskProtocol.VERSION).put("taskId", taskId).put("executionId", executionId).put("status", if (passed) "completed" else "failed")
        .put("message", message).put("artifacts", JSONArray().also { if (path.isNotBlank()) it.put(JSONObject().put("path", path)) }).put("validation", JSONObject().put("passed", passed))

    private fun child(root: String, path: String) = if (root.isBlank()) path else "$root/$path"
    private data class Extracted(val text: String, val pageCount: Int, val previewJpeg: ByteArray)
    companion object { private const val MAX_PDF_PAGES = 50 }
}
