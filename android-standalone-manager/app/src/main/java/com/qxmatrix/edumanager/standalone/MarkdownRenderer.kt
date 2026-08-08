package com.qxmatrix.edumanager.standalone

object MarkdownRenderer {
    fun html(markdown: String, fontSize: Int = 17): String {
        val body = StringBuilder(); val lines = markdown.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        var inCode = false; var inList = false; var inTable = false
        fun closeTable() { if (inTable) { body.append("</tbody></table></div>"); inTable = false } }
        fun closeList() { if (inList) { body.append("</ul>"); inList = false } }
        lines.forEachIndexed { index, line ->
            val trimmed = line.trim()
            if (trimmed.startsWith("```")) { closeTable(); closeList(); body.append(if (inCode) "</code></pre>" else "<pre><code>"); inCode = !inCode; return@forEachIndexed }
            if (inCode) { body.append(escape(line)).append('\n'); return@forEachIndexed }
            if (trimmed.isBlank()) { closeTable(); closeList(); body.append("<div class=\"space\"></div>"); return@forEachIndexed }
            if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                closeList(); if (!inTable) { body.append("<div class=\"table-wrap\"><table><tbody>"); inTable = true }
                val cells = trimmed.substring(1, trimmed.length - 1).split('|')
                if (!cells.all { it.trim().matches(Regex(":?-{3,}:?")) }) {
                    body.append("<tr>"); val previousWasTable = index > 0 && lines[index - 1].trim().let { it.startsWith('|') && it.endsWith('|') }
                    cells.forEach { cell -> val tag = if (previousWasTable) "td" else "th"; body.append("<$tag>").append(inline(cell.trim())).append("</$tag>") }; body.append("</tr>")
                }
                return@forEachIndexed
            }
            closeTable()
            if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ")) {
                if (!inList) { body.append("<ul>"); inList = true }; body.append("<li>").append(inline(trimmed.substring(2))).append("</li>"); return@forEachIndexed
            }
            closeList()
            when {
                trimmed.startsWith("### ") -> body.append("<h3>").append(inline(trimmed.substring(4))).append("</h3>")
                trimmed.startsWith("## ") -> body.append("<h2>").append(inline(trimmed.substring(3))).append("</h2>")
                trimmed.startsWith("# ") -> body.append("<h1>").append(inline(trimmed.substring(2))).append("</h1>")
                trimmed.startsWith("> ") -> body.append("<blockquote>").append(inline(trimmed.substring(2))).append("</blockquote>")
                trimmed.matches(Regex("-{3,}|\\*{3,}|_{3,}")) -> body.append("<hr>")
                else -> body.append("<p>").append(inline(line)).append("</p>")
            }
        }
        closeTable(); closeList(); if (inCode) body.append("</code></pre>")
        return """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;padding:18px 18px 42px;background:#fff;color:#21312f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:${fontSize}px;line-height:1.78}h1,h2,h3{color:#0f766e;margin:16px 0 8px;line-height:1.32}h1{font-size:1.7em}h2{font-size:1.35em}h3{font-size:1.13em}p{margin:0 0 10px}a{color:#0f766e;font-weight:700}strong{font-weight:800}em{color:#3c5652}blockquote{margin:10px 0;padding:10px 12px;border-left:4px solid #7dd3c7;border-radius:10px;background:#eefaf7;color:#49605c}ul{margin:0 0 12px;padding-left:24px}li{margin:5px 0}code{padding:2px 5px;border-radius:6px;background:#e9f4f0;color:#0f5f54;font-family:monospace}pre{overflow-x:auto;margin:10px 0;padding:12px;border-radius:12px;background:#10201f;color:#e8fff8}pre code{padding:0;background:transparent;color:inherit;white-space:pre}.table-wrap{overflow-x:auto;margin:12px 0}table{min-width:560px;width:100%;border-collapse:collapse;font-size:.92em}th,td{border:1px solid #d7e7e2;padding:8px;text-align:left;vertical-align:top}th{background:#edf8f4;color:#0f766e}hr{border:0;border-top:1px solid #d7e7e2;margin:14px 0}.space{height:8px}</style></head><body>${body}</body></html>"""
    }

    private fun inline(text: String): String = escape(text)
        .replace(Regex("`([^`]+)`"), "<code>$1</code>")
        .replace(Regex("\\*\\*([^*]+)\\*\\*"), "<strong>$1</strong>")
        .replace(Regex("\\*([^*]+)\\*"), "<em>$1</em>")
        .replace(Regex("\\[([^]]+)]\\((https?://[^)\\s]+)\\)"), "<a href=\"$2\">$1</a>")

    private fun escape(value: String): String = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")
}
