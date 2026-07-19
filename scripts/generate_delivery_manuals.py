from __future__ import annotations

import re
from html import escape as html_escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parents[1]
DELIVERY = ROOT / "docs" / "delivery"
WEBSITE = ROOT / "release" / "网站文件"
FONT_PATH = Path("C:/Windows/Fonts/msyh.ttc")
FONT_BOLD_PATH = Path("C:/Windows/Fonts/msyhbd.ttc")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("ManualCN", str(FONT_PATH), subfontIndex=0))
    bold_path = FONT_BOLD_PATH if FONT_BOLD_PATH.exists() else FONT_PATH
    pdfmetrics.registerFont(TTFont("ManualCN-Bold", str(bold_path), subfontIndex=0))


def escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def inline_markup(text: str) -> str:
    value = escape(text.strip())
    value = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"`(.+?)`", r'<font name="ManualCN">\1</font>', value)
    return value


def make_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("TitleCN", parent=base["Title"], fontName="ManualCN-Bold", fontSize=22, leading=31, textColor=colors.HexColor("#172033"), alignment=TA_CENTER, spaceAfter=12 * mm),
        "h2": ParagraphStyle("H2CN", parent=base["Heading2"], fontName="ManualCN-Bold", fontSize=15, leading=22, textColor=colors.HexColor("#6D28D9"), spaceBefore=7 * mm, spaceAfter=3 * mm, keepWithNext=True),
        "h3": ParagraphStyle("H3CN", parent=base["Heading3"], fontName="ManualCN-Bold", fontSize=12, leading=18, textColor=colors.HexColor("#334155"), spaceBefore=4 * mm, spaceAfter=2 * mm, keepWithNext=True),
        "body": ParagraphStyle("BodyCN", parent=base["BodyText"], fontName="ManualCN", fontSize=10.2, leading=16.5, textColor=colors.HexColor("#253046"), spaceAfter=2.2 * mm, wordWrap="CJK"),
        "bullet": ParagraphStyle("BulletCN", parent=base["BodyText"], fontName="ManualCN", fontSize=10.2, leading=16.5, leftIndent=6 * mm, firstLineIndent=-4 * mm, textColor=colors.HexColor("#253046"), spaceAfter=1.5 * mm, wordWrap="CJK"),
        "code": ParagraphStyle("CodeCN", parent=base["Code"], fontName="ManualCN", fontSize=9.2, leading=14, leftIndent=5 * mm, rightIndent=5 * mm, backColor=colors.HexColor("#F4F1FF"), borderColor=colors.HexColor("#D8CCFF"), borderWidth=0.5, borderPadding=4 * mm, spaceBefore=2 * mm, spaceAfter=3 * mm, wordWrap="CJK"),
    }


def footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#E2E8F0"))
    canvas.line(18 * mm, 14 * mm, 192 * mm, 14 * mm)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.setFont("ManualCN", 8)
    canvas.drawString(18 * mm, 9 * mm, "AI教育管家")
    canvas.drawRightString(192 * mm, 9 * mm, f"第 {doc.page} 页")
    canvas.restoreState()


def markdown_story(text: str, styles):
    story = []
    in_code = False
    code_lines: list[str] = []
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("```"):
            if in_code:
                code = "<br/>".join(escape(item) or "&nbsp;" for item in code_lines)
                story.append(Paragraph(code, styles["code"]))
                code_lines = []
            in_code = not in_code
            continue
        if in_code:
            code_lines.append(line)
            continue
        if not line.strip():
            story.append(Spacer(1, 1.5 * mm))
        elif line.startswith("# "):
            story.append(Paragraph(inline_markup(line[2:]), styles["title"]))
        elif line.startswith("## "):
            story.append(Paragraph(inline_markup(line[3:]), styles["h2"]))
        elif line.startswith("### "):
            story.append(Paragraph(inline_markup(line[4:]), styles["h3"]))
        elif re.match(r"^\d+\.\s", line):
            story.append(Paragraph(inline_markup(line), styles["bullet"]))
        elif line.startswith("- "):
            story.append(Paragraph("• " + inline_markup(line[2:]), styles["bullet"]))
        elif line.startswith("> "):
            story.append(Paragraph(inline_markup(line[2:]), styles["code"]))
        else:
            story.append(Paragraph(inline_markup(line), styles["body"]))
    return story


def build_manual(markdown_name: str, pdf_name: str) -> None:
    text = (DELIVERY / markdown_name).read_text(encoding="utf-8")
    output = DELIVERY / pdf_name
    doc = SimpleDocTemplate(str(output), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=17 * mm, bottomMargin=18 * mm, title=text.splitlines()[0].lstrip("# "), author="嘉玛蓝（北京）科技有限公司")
    doc.build(markdown_story(text, make_styles()), onFirstPage=footer, onLaterPages=footer)


def manual_html(markdown_text: str, current_page: str) -> str:
    lines = markdown_text.splitlines()
    title = lines[0].lstrip("# ").strip()
    article: list[str] = []
    toc: list[tuple[str, str]] = []
    in_code = False
    code_lines: list[str] = []
    list_type: str | None = None

    def close_list() -> None:
        nonlocal list_type
        if list_type:
            article.append(f"</{list_type}>")
            list_type = None

    def inline(text: str) -> str:
        value = html_escape(text.strip())
        value = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", value)
        value = re.sub(r"`(.+?)`", r"<code>\1</code>", value)
        return value

    heading_index = 0
    for raw in lines[1:]:
        line = raw.rstrip()
        if line.startswith("```"):
            close_list()
            if in_code:
                article.append(f"<pre><code>{html_escape(chr(10).join(code_lines))}</code></pre>")
                code_lines = []
            in_code = not in_code
            continue
        if in_code:
            code_lines.append(line)
            continue
        if not line.strip():
            close_list()
            continue
        if line.startswith("## "):
            close_list()
            heading_index += 1
            text = line[3:].strip()
            heading_id = f"section-{heading_index}"
            toc.append((heading_id, text))
            article.append(f'<h2 id="{heading_id}">{inline(text)}</h2>')
        elif line.startswith("### "):
            close_list()
            article.append(f"<h3>{inline(line[4:])}</h3>")
        elif re.match(r"^\d+\.\s", line):
            if list_type != "ol":
                close_list()
                list_type = "ol"
                article.append("<ol>")
            article.append(f"<li>{inline(re.sub(r'^\d+\.\s*', '', line))}</li>")
        elif line.startswith("- "):
            if list_type != "ul":
                close_list()
                list_type = "ul"
                article.append("<ul>")
            article.append(f"<li>{inline(line[2:])}</li>")
        elif line.startswith("> "):
            close_list()
            article.append(f"<blockquote>{inline(line[2:])}</blockquote>")
        else:
            close_list()
            article.append(f"<p>{inline(line)}</p>")
    close_list()

    toc_html = "".join(f'<a href="#{heading_id}">{html_escape(text)}</a>' for heading_id, text in toc)
    nav_windows = ' aria-current="page"' if current_page == "windows" else ""
    nav_tablet = ' aria-current="page"' if current_page == "tablet" else ""
    return f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html_escape(title)} - 群星矩阵</title>
  <meta name="description" content="{html_escape(title)}" />
  <style>
    :root {{ --ink:#172033; --muted:#66758a; --line:#e3eaf2; --accent:#6d28d9; --soft:#f7f5ff; }}
    * {{ box-sizing:border-box; }}
    html {{ scroll-behavior:smooth; }}
    body {{ margin:0; overflow-x:hidden; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif; color:var(--ink); background:#f7f9fc; line-height:1.8; }}
    .topbar {{ position:sticky; top:0; z-index:20; border-bottom:1px solid var(--line); background:rgba(255,255,255,.94); backdrop-filter:blur(14px); }}
    .topbar-inner {{ width:min(1180px,calc(100% - 32px)); min-height:66px; margin:auto; display:flex; align-items:center; justify-content:space-between; gap:20px; }}
    .brand {{ color:var(--ink); font-weight:800; text-decoration:none; white-space:nowrap; }}
    .menu {{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }}
    .menu a {{ padding:8px 12px; border-radius:7px; color:#4b5c70; text-decoration:none; font-size:14px; }}
    .menu a:hover,.menu a[aria-current="page"] {{ color:var(--accent); background:var(--soft); }}
    .layout {{ width:min(1180px,calc(100% - 32px)); margin:32px auto 64px; display:grid; grid-template-columns:240px minmax(0,1fr); gap:28px; align-items:start; }}
    .toc {{ position:sticky; top:92px; max-height:calc(100vh - 116px); overflow:auto; padding:16px; border:1px solid var(--line); border-radius:8px; background:#fff; }}
    .toc strong {{ display:block; margin:0 8px 10px; font-size:14px; }}
    .toc a {{ display:block; padding:6px 8px; border-radius:5px; color:#66758a; text-decoration:none; font-size:13px; line-height:1.45; }}
    .toc a:hover {{ color:var(--accent); background:var(--soft); }}
    article {{ min-width:0; padding:46px clamp(24px,6vw,72px); border:1px solid var(--line); border-radius:8px; background:#fff; box-shadow:0 18px 48px rgba(39,52,76,.08); }}
    h1 {{ margin:0 0 22px; font-size:clamp(28px,4vw,42px); line-height:1.2; letter-spacing:0; overflow-wrap:anywhere; }}
    h2 {{ margin:46px 0 18px; padding-top:8px; color:var(--accent); font-size:24px; line-height:1.35; letter-spacing:0; border-top:1px solid var(--line); }}
    h2:first-of-type {{ margin-top:28px; border-top:0; }}
    h3 {{ margin:28px 0 12px; font-size:18px; letter-spacing:0; }}
    p {{ margin:12px 0; color:#35455a; overflow-wrap:anywhere; }}
    ol,ul {{ margin:12px 0; padding-left:26px; }}
    li {{ margin:7px 0; color:#35455a; overflow-wrap:anywhere; }}
    code {{ padding:2px 6px; border-radius:4px; background:#f0edf9; color:#5422aa; font-family:Consolas,"Microsoft YaHei",monospace; }}
    pre {{ overflow:auto; padding:18px; border:1px solid #ddd4ff; border-radius:7px; background:#f7f5ff; line-height:1.55; }}
    pre code {{ padding:0; background:transparent; color:#273447; }}
    blockquote {{ margin:18px 0; padding:14px 18px; border-left:4px solid var(--accent); background:var(--soft); color:#4b3b67; }}
    footer {{ padding:30px 16px; text-align:center; color:#8b98a9; font-size:13px; }}
    @media(max-width:820px) {{ .topbar-inner {{ width:calc(100% - 24px); min-width:0; align-items:flex-start; flex-direction:column; padding:14px 0; }} .menu {{ width:100%; min-width:0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); justify-content:stretch; }} .menu a {{ min-width:0; padding:8px; text-align:center; overflow-wrap:anywhere; }} .layout {{ width:calc(100% - 24px); min-width:0; grid-template-columns:minmax(0,1fr); margin-top:20px; }} .toc {{ position:static; min-width:0; max-height:260px; }} article {{ min-width:0; padding:30px 22px; }} h1 {{ font-size:28px; }} }}
  </style>
</head>
<body>
  <header class="topbar"><div class="topbar-inner">
    <a class="brand" href="./download.html">AI教育管家</a>
    <nav class="menu" aria-label="网站菜单">
      <a href="./download.html">软件下载</a>
      <a href="./windows-manual.html"{nav_windows}>Windows 主机版手册</a>
      <a href="./tablet-manual.html"{nav_tablet}>平板终端家长版手册</a>
      <a href="./privacy.html">隐私政策</a>
      <a href="./agreement.html">用户协议</a>
    </nav>
  </div></header>
  <main class="layout">
    <aside class="toc"><strong>本页目录</strong>{toc_html}</aside>
    <article><h1>{html_escape(title)}</h1>{''.join(article)}</article>
  </main>
  <footer>嘉玛蓝（北京）科技有限公司版权所有</footer>
</body>
</html>'''


def build_web_manual(markdown_name: str, html_name: str, current_page: str) -> None:
    text = (DELIVERY / markdown_name).read_text(encoding="utf-8")
    WEBSITE.mkdir(parents=True, exist_ok=True)
    (WEBSITE / html_name).write_text(manual_html(text, current_page), encoding="utf-8")


def main() -> None:
    register_fonts()
    build_manual("Windows主机版操作手册.md", "AI教育管家 Windows 主机版操作手册.pdf")
    build_manual("平板终端家长版操作手册.md", "AI教育管家平板终端家长版操作手册.pdf")
    build_web_manual("Windows主机版操作手册.md", "windows-manual.html", "windows")
    build_web_manual("平板终端家长版操作手册.md", "tablet-manual.html", "tablet")


if __name__ == "__main__":
    main()
