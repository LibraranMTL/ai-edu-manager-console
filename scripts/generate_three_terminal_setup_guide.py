from __future__ import annotations

from pathlib import Path
from shutil import copy2

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
DELIVERY = ROOT / "docs" / "delivery"
CANONICAL = DELIVERY / "AI教育管家_三端初始设置指南.docx"
COMPATIBLE = DELIVERY / "AI教育管家_主机与平板初始设置指南_安全修订版.docx"


def set_cell_shading(cell, color: str) -> None:
    properties = cell._tc.get_or_add_tcPr()
    shading = OxmlElement("w:shd")
    shading.set(qn("w:fill"), color)
    properties.append(shading)


def add_bullet(document: Document, text: str) -> None:
    paragraph = document.add_paragraph(style="List Bullet")
    paragraph.add_run(text)


def add_number(document: Document, text: str) -> None:
    paragraph = document.add_paragraph(style="List Number")
    paragraph.add_run(text)


def configure_document(document: Document) -> None:
    section = document.sections[0]
    section.top_margin = Cm(1.8)
    section.bottom_margin = Cm(1.7)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)

    normal = document.styles["Normal"]
    normal.font.name = "Microsoft YaHei"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.font.size = Pt(10.5)

    for name, size, color in [
        ("Title", 24, "172033"),
        ("Heading 1", 16, "6D28D9"),
        ("Heading 2", 12, "334155"),
    ]:
        style = document.styles[name]
        style.font.name = "Microsoft YaHei"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor.from_string(color)
        style.font.bold = True

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.add_run("AI教育管家三端初始设置指南 | Windows 主机端 0.9.8 | Windows 学生端 0.9.8 | Android 学生端 0.6.0")


def build_guide() -> Document:
    document = Document()
    configure_document(document)

    title = document.add_paragraph(style="Title")
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.add_run("AI教育管家三端初始设置指南")
    subtitle = document.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle.add_run("Windows 主机端 + Windows 学生端 + Android 学生端")
    run.bold = True
    run.font.color.rgb = RGBColor(109, 40, 217)
    note = document.add_paragraph()
    note.alignment = WD_ALIGN_PARAGRAPH.CENTER
    note.add_run("适用版本：0.9.8 / 0.9.8 / 0.6.0   更新日期：2026-07-22")

    document.add_heading("1. 先选择正确版本", level=1)
    table = document.add_table(rows=1, cols=4)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"
    headers = ["版本", "安装位置", "主要使用者", "主要职责"]
    for index, text in enumerate(headers):
        cell = table.rows[0].cells[index]
        cell.text = text
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_shading(cell, "EDE9FE")
        for run in cell.paragraphs[0].runs:
            run.bold = True
    rows = [
        ("Windows 主机端 0.9.8", "教师或家长电脑", "教师、家长", "学生档案、资料治理、学习项目、成长模型、学情报告、教育档案、终端授权"),
        ("Windows 学生端 0.9.8", "学生 Windows 电脑", "学生", "本地文件上传、屏幕资料采集、自动投递文件夹"),
        ("Android 学生端 0.6.0", "Android 平板或手机", "学生", "拍照、文件上传、系统分享、屏幕资料采集、查看已发布档案"),
    ]
    for row in rows:
        cells = table.add_row().cells
        for index, text in enumerate(row):
            cells[index].text = text
            cells[index].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

    document.add_paragraph("学生端不提供档案初始化、项目管理、知识治理或报告发布功能。不要在学生电脑上安装主机端代替学生端。")

    document.add_heading("2. Windows 主机端首次设置", level=1)
    add_number(document, "运行 AI-edu-manager-console-Windows-0.9.8.zip 中的主机程序。")
    add_number(document, "创建或接管学生档案，确认学生资料根目录和知识库可以正常打开。")
    add_number(document, "打开主机-终端模式，启动学生终端协作服务。")
    add_number(document, "确认主机地址和端口，默认服务端口为 18777；按需允许 Windows 防火墙专用网络访问。")
    add_number(document, "准备连接信息，供 Windows 学生端粘贴，或供 Android 学生端扫码、发现和连接。")

    document.add_heading("3. 连接 Windows 学生端", level=1)
    add_number(document, "在学生电脑运行 AI-edu-manager-student-terminal-Windows-0.9.8.exe。")
    add_number(document, "粘贴主机连接信息；也可填写主机地址和六位配对码。")
    add_number(document, "由教师或家长在主机设备列表中确认该终端，并授权全部学生或指定学生。")
    add_number(document, "返回 Windows 学生端刷新，确认可以看到获准学生及其绑定项目。")

    document.add_heading("4. 连接 Android 学生端", level=1)
    add_number(document, "安装 AI-edu-manager-tablet-terminal-0.6.0.apk。")
    add_number(document, "确保 Android 设备与主机位于同一局域网。")
    add_number(document, "在连接设置中查找局域网主机，核对固定主机码并发起连接；也可扫码或粘贴连接信息。")
    add_number(document, "由教师或家长在主机端接受连接并授权学生。")
    add_number(document, "返回 Android 学生端刷新学生列表。")

    document.add_heading("5. 三端统一的资料归属规则", level=1)
    document.add_paragraph("Windows 主机端本地导入、Windows 学生端上传、Windows 自动投递文件夹，以及 Android 学生端普通文件和屏幕采集上传，都需要选择以下目标之一：")
    add_bullet(document, "学生原始资料库：日常作业、学习记录和不属于特定项目的资料。")
    add_bullet(document, "绑定项目原始资料库：项目研究、作品、过程截图和项目参考资料。")
    document.add_paragraph("项目列表只显示当前学生已经绑定且未封存的项目。主机端还会再次校验设备授权、学生归属和项目绑定。")

    document.add_heading("6. Windows 自动投递文件夹", level=1)
    add_number(document, "在 Windows 学生端先选择学生和资料目标。")
    add_number(document, "选择本地文件夹，勾选启用并保存。")
    add_number(document, "终端保持运行时会定期检查新文件并自动投递。")
    add_bullet(document, "本地文件不会被删除或移动。")
    add_bullet(document, "已成功送达的同一文件不会重复上传。")
    add_bullet(document, "更换学生或项目后，需要重新保存自动投递目标。")

    document.add_heading("7. 交付前验收", level=1)
    checks = [
        "主机端显示 v0.9.8，学生档案和项目可以正常读取。",
        "Windows 学生端和 Android 学生端都只能看到主机授权的学生。",
        "三个普通文件入口都能选择学生原始资料库或绑定项目原始资料库。",
        "Windows 自动投递文件夹上传成功后仍保留本地文件。",
        "Android 上传按钮具有按下、正在上传、绿色完成和橙色失败重试反馈。",
        "项目资料上传后在主机对应项目中进入待消化状态。",
    ]
    for check in checks:
        add_bullet(document, check)

    document.add_heading("8. 常见问题", level=1)
    document.add_heading("终端已连接但看不到学生", level=2)
    document.add_paragraph("在主机设备列表中确认该终端已获授权，并检查授权学生是否仍然存在。授权后返回学生端刷新。")
    document.add_heading("看不到绑定项目", level=2)
    document.add_paragraph("确认项目已绑定当前学生且未封存，然后刷新学生端。")
    document.add_heading("局域网找不到主机", level=2)
    document.add_paragraph("确认主机服务正在运行、设备位于同一局域网、Windows 防火墙允许专用网络访问，并关闭访客网络或客户端隔离。")
    document.add_heading("上传后没有立即出现知识或报告", level=2)
    document.add_paragraph("上传只完成资料采集。主机还需要完成资料消化、成长证据更新、周期报告生成和发布。")

    return document


def main() -> None:
    DELIVERY.mkdir(parents=True, exist_ok=True)
    document = build_guide()
    document.save(CANONICAL)
    copy2(CANONICAL, COMPATIBLE)
    print(CANONICAL)
    print(COMPATIBLE)


if __name__ == "__main__":
    main()
