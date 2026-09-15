package com.qxmatrix.edumanager.standalone

object EducationPublicationRenderer {
    fun html(
        draft: EducationPublicationDraft,
        studentName: String,
        colorMode: String,
        outputFormat: String,
        overrideMarkdown: String? = null,
    ): String {
        val monochrome = colorMode == "monochrome"
        val card = draft.mode == "card" || outputFormat == "png"
        val body = if (overrideMarkdown != null || draft.mode == "document") {
            val rendered = MarkdownRenderer.html(overrideMarkdown ?: draft.markdown)
            "<section class=\"markdown-body\">${rendered.substringAfter("<body>").substringBeforeLast("</body>")}</section>"
        } else {
            "<section class=\"summary-sections\">" + draft.sections.joinToString("") { section ->
                "<article data-kind=\"${escape(section.id)}\"><h2>${escape(section.label)}</h2><ul>" +
                    section.items.joinToString("") { "<li>${escape(it.text)}</li>" } + "</ul></article>"
            } + "</section>"
        }
        val textLength = (overrideMarkdown ?: draft.renderedMarkdown()).length
        val density = if (card && textLength > 820) " dense" else ""
        val pageBackground = if (monochrome) "#ffffff" else "linear-gradient(150deg,#ffffff 0%,#faf8ff 62%,#eee7ff 100%)"
        val canvasBackground = if (monochrome) "#ffffff" else "#f3f1ff"
        val accent = if (monochrome) "#111111" else "#5e2bc2"
        val border = if (monochrome) "#333333" else "#d8cdf8"
        val pageWidth = "100%"
        // The viewport width is device independent; 177.778vw keeps cached PNG cards at 9:16 on every density.
        val pageMinHeight = if (card) "177.778vw" else "0"
        val padding = if (card) "36px 34px 31px" else "56px 62px 72px"
        return """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
            @page{size:A4;margin:16mm 16mm 18mm}*{box-sizing:border-box}html,body{margin:0;background:$canvasBackground;color:#172335;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}.page{width:$pageWidth;min-height:$pageMinHeight;padding:$padding;margin:0 auto;background:$pageBackground;position:relative}.eyebrow{font-size:${if (card) "11px" else "11pt"};letter-spacing:.14em;color:$accent;font-weight:800}.title{font-size:${if (card) "26px" else "28pt"};line-height:1.2;margin:${if (card) "11px 0 5px" else "18px 0 8px"};word-break:break-word}.subtitle{font-size:${if (card) "12px" else "12pt"};color:#667085;margin:0 0 ${if (card) "15px" else "28px"}}.markdown-body{font-size:${if (card) "12px" else "12pt"};line-height:1.72}.markdown-body h1{display:none}.markdown-body h2{font-size:1.42em;color:$accent;margin:26px 0 10px;break-after:avoid}.markdown-body h3{font-size:1.2em;color:$accent;break-after:avoid}.markdown-body table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:.78em}.markdown-body tr{break-inside:avoid}.markdown-body th,.markdown-body td{border:1px solid #b7bec8;padding:7px;word-break:break-word}.markdown-body blockquote{border-left:4px solid $accent;margin:16px 0;padding:10px 14px;color:#4b5563}.summary-sections{display:grid;gap:${if (card) "10px" else "18px"}}.summary-sections article{border:2px solid $border;border-radius:${if (card) "12px" else "16px"};padding:${if (card) "12px 14px" else "18px 22px"};background:${if (monochrome) "#fff" else "rgba(255,255,255,.9)"};break-inside:avoid}.summary-sections h2{color:$accent;font-size:${if (card) "12px" else "15pt"};margin:0 0 5px}.summary-sections ul{margin:0;padding-left:1.2em}.summary-sections li{font-size:${if (card) "13px" else "11.5pt"};line-height:1.55;margin:3px 0}.dense .title{font-size:22px}.dense .summary-sections{gap:7px}.dense .summary-sections article{padding:8px 11px}.dense .summary-sections li{font-size:11px;line-height:1.38;margin:2px 0}.meta{margin-top:${if (card) "17px" else "32px"};display:flex;justify-content:space-between;gap:18px;border-top:1px solid #c9ced6;padding-top:8px;font-size:${if (card) "10px" else "9pt"};color:#6b7280}@media print{html,body{background:#fff}.page{box-shadow:none;padding:0}.meta{position:relative}a{color:inherit;text-decoration:none}}
        </style></head><body><main class="page$density"><div class="eyebrow">AI 教育管家 · ROBOGALA</div><h1 class="title">${escape(draft.title)}</h1><p class="subtitle">${escape(draft.subtitle)}</p>$body<footer class="meta"><span>${escape(studentName)}</span><span>${escape(Timestamp.now().take(10))}</span></footer></main></body></html>"""
    }

    private fun escape(value: String): String = value.replace("&", "&amp;").replace("<", "&lt;")
        .replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")
}
