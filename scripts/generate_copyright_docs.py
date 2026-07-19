from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "copyright"

SOFTWARE_NAME = "AI教育管家主机控制台与平板终端系统"
VERSION = "V0.7.49"
WINDOWS_VERSION = "0.7.49"
TABLET_TERMINAL_VERSION = "0.5.4"
OWNER = "嘉玛蓝（北京）科技有限公司"
COPYRIGHT_LINE = f"{OWNER}版权所有"
PROJECT_TEAM = [
    ("包晓闻", "项目负责人、产品规划、总体架构设计、核心功能验收"),
    ("赵立颖", "产品测试、用户流程验证、交付协同"),
    ("包书源", "用户场景测试、学习资料流程验证"),
    ("赵书源", "用户场景测试、档案浏览流程验证"),
    ("包书杨", "用户场景测试、平板终端使用反馈"),
]

DOC_FONT = "SimSun"
CODE_FONT = "Consolas"


def set_run_font(run, size_pt: float, bold: bool = False, font_name: str = DOC_FONT) -> None:
    run.font.name = font_name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font_name)
    run.font.size = Pt(size_pt)
    run.bold = bold


def add_page_number(paragraph) -> None:
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    paragraph.add_run("第 ")
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = "PAGE"
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    fld_text = OxmlElement("w:t")
    fld_text.text = "1"
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_sep)
    run._r.append(fld_text)
    run._r.append(fld_end)
    paragraph.add_run(" 页")


def configure_page(doc: Document) -> None:
    section = doc.sections[0]
    section.page_width = Inches(8.27)
    section.page_height = Inches(11.69)
    section.top_margin = Inches(0.72)
    section.bottom_margin = Inches(0.72)
    section.left_margin = Inches(0.78)
    section.right_margin = Inches(0.78)
    section.header_distance = Inches(0.28)
    section.footer_distance = Inches(0.28)

    header = section.header.paragraphs[0]
    header.text = f"{SOFTWARE_NAME} {VERSION}"
    header.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in header.runs:
        set_run_font(run, 9, False)

    footer = section.footer.paragraphs[0]
    footer.text = COPYRIGHT_LINE + "    "
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in footer.runs:
        set_run_font(run, 9, False)
    add_page_number(footer)
    for run in footer.runs:
        set_run_font(run, 9, False)


def add_official_line(doc: Document, text: str, *, bold: bool = False, size: float = 10.5) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    p.paragraph_format.line_spacing = Pt(15)
    r = p.add_run(text)
    set_run_font(r, size, bold)


def add_code_line(doc: Document, text: str) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    p.paragraph_format.line_spacing = Pt(9.6)
    r = p.add_run(text if text else " ")
    set_run_font(r, 7.2, False, CODE_FONT)


def pad_to_multiple(lines: list[str], page_size: int, filler_prefix: str) -> list[str]:
    output = list(lines)
    remainder = len(output) % page_size
    if remainder:
        for i in range(page_size - remainder):
            output.append(f"{filler_prefix}：本页补充说明 {i + 1}。")
    return output


def closing_lines_for(title: str) -> list[str]:
    if "用户操作手册" in title:
        return [
            "附：本手册已覆盖 Windows 主机控制台的启动、配置、初始化、接管、主机服务和设备管理流程。",
            "附：本手册已覆盖 Android 平板终端的绑定、上传资料、查看档案和联系教育管家流程。",
            "附：本手册中的路径示例以 D:\\学生资料 作为默认学生资料根目录。",
            "附：本手册中的学生姓名示例仅用于说明操作流程，不代表真实生产数据。",
            "附：本手册中的 Agent 工具名称用于说明系统支持的工具类型和操作入口。",
            "附：本手册中的 QClaw 消化流程用于说明学习资料从上传到沉淀为档案的闭环。",
            "附：本手册中的设备授权说明用于解释平板终端访问学生资料的控制方式。",
            "附：本手册中的远程连接说明用于解释局域网和 Tailscale 两种连接方式。",
            "附：本手册中的异常处理说明用于辅助装机人员和管理员排查常见问题。",
            "附：正式提交时，软件名称、版本号和著作权人应与申请表保持一致。",
            "附：正式提交时，文档应使用 A4 页面、单面打印并保持页码连续。",
            "附：正式提交时，如代理机构要求调整格式，可在不改变事实内容的前提下调整。",
        ]
    if "软件设计说明书" in title:
        return [
            "附：本设计说明书已描述系统目标、总体架构、主要模块和数据结构。",
            "附：本设计说明书已描述标准知识库和接管知识库两种路径管理方式。",
            "附：本设计说明书已描述 Agent 工具能力配置表和不同工具的绑定逻辑。",
            "附：本设计说明书已描述 Windows 主机 HTTP 服务的主要接口。",
            "附：本设计说明书已描述设备 token、学生访问范围和撤销设备机制。",
            "附：本设计说明书已描述 Android 原生文件选择、拍照、扫码和上传能力。",
            "附：本设计说明书已描述 Markdown 档案分类和离线缓存设计。",
            "附：本设计说明书已描述版本发布、更新检查和双 APK 产品定位。",
            "附：本设计说明书已描述异常处理、安全控制和本地资料保护原则。",
            "附：本设计说明书中的项目组成员信息仅用于说明开发参与和职责分工。",
            "附：正式提交时，软件名称、版本号和著作权人应与申请表保持一致。",
            "附：正式提交时，如代理机构要求调整章节顺序，可在不改变事实内容的前提下调整。",
        ]
    if "项目组成员及职责说明" in title:
        return [
            "附：本说明仅用于补充记录项目组成员及职责分工。",
            "附：本说明不替代软件著作权登记申请表。",
            "附：本说明不替代营业执照、项目任务书、合同或其他权属证明文件。",
            "附：本说明不作为源程序鉴别材料的一部分。",
            "附：本说明不改变软件著作权人归属。",
            f"附：本说明建议与{OWNER}内部项目资料一并留档。",
            "附：如代理机构要求，可将本说明作为补充材料提交。",
            "附：如无需补充人员说明，可仅将本说明作为公司内部归档材料。",
            "附：正式提交时，申请表填写内容仍以登记系统生成文本为准。",
            "附：正式提交时，成员姓名和职责应与公司内部确认结果保持一致。",
            "附：正式提交时，如需盖章，应由著作权人统一办理。",
            "附：本说明结束。",
        ]
    if "申请表填写信息草稿" in title:
        return [
            "附：本草稿用于辅助在线填写计算机软件著作权登记申请表。",
            "附：正式申请表应以中国版权保护中心登记系统在线生成版本为准。",
            "附：正式提交前应补齐统一社会信用代码、注册地址、联系人和联系电话。",
            "附：开发完成日期、首次发表日期和发表状态应由申请人最终确认。",
            "附：申请表打印后应由著作权人按要求签章。",
            "附：申请表中的软件名称、版本号应与鉴别材料页眉保持一致。",
            "附：申请表中的著作权人名称应与营业执照名称保持一致。",
            "附：如委托代理机构办理，应另行签署代理委托材料。",
            "附：本草稿不替代官方申请表。",
        ]
    if "公司组织开发及权属说明" in title:
        return [
            "附：本说明用于配合证明软件由公司组织开发并享有相应著作权。",
            "附：正式提交时可根据代理机构意见决定是否作为补充证明材料提交。",
            "附：如已有劳动合同、项目任务书、立项文件或内部验收记录，应与本说明共同留档。",
            "附：如存在外部委托开发或合作开发，应另行准备对应合同和权属约定。",
            "附：本说明中的公司名称应与营业执照名称保持一致。",
            "附：如提交纸质材料，应按要求加盖公司公章。",
            "附：本说明不替代营业执照复印件。",
        ]
    if "原创性与真实性声明" in title:
        return [
            "附：本声明用于说明软件材料真实性、原创性和提交一致性。",
            "附：正式提交时可根据代理机构意见决定是否作为补充证明材料提交。",
            "附：源程序鉴别材料应来自当前登记版本对应源码。",
            "附：文档鉴别材料应与软件名称、版本号和著作权人保持一致。",
            "附：如软件包含第三方开源组件，应在内部留档中保存对应许可信息。",
            "附：如提交纸质材料，应按要求加盖公司公章。",
            "附：本声明不替代官方申请表中的申请人承诺。",
        ]
    if "申请材料目录与提交检查清单" in title:
        return [
            "附：本清单用于提交前核对材料是否齐备。",
            "附：官方在线申请表仍需在登记系统中生成并打印。",
            "附：营业执照副本复印件需要另行准备并加盖公章。",
            "附：鉴别材料应按 A4、单面、黑白打印要求处理。",
            "附：所有材料中的软件名称和版本号应保持一致。",
            "附：签章名称应与申请表中的著作权人名称完全一致。",
            "附：如代理办理，应补充代理委托文件。",
        ]
    return [
        "附：本页内容用于补足正式材料的页面行数要求，并保持事实内容完整。",
        "附：正式提交时，软件名称、版本号和著作权人应与申请表保持一致。",
        "附：正式提交时，如代理机构要求调整格式，可在不改变事实内容的前提下调整。",
    ]


def pad_document_lines(lines: list[str], page_size: int, title: str) -> list[str]:
    output = list(lines)
    remainder = len(output) % page_size
    if not remainder:
        return output
    fillers = closing_lines_for(title)
    needed = page_size - remainder
    for index in range(needed):
        output.append(fillers[index % len(fillers)])
    return output


def write_line_doc(path: Path, title: str, subtitle: str, lines: list[str], lines_per_page: int = 30) -> int:
    doc = Document()
    configure_page(doc)
    doc.styles["Normal"].font.name = DOC_FONT
    doc.styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), DOC_FONT)

    all_lines = [
        title,
        f"软件名称：{SOFTWARE_NAME}",
        f"版本号：{VERSION}",
        f"著作权人：{OWNER}",
        f"文档用途：{subtitle}",
        f"生成日期：{datetime.now().strftime('%Y年%m月%d日')}",
        "格式说明：A4页面，页眉标注软件名称和版本号，页脚标注版权信息和页码。",
        "提交说明：本材料按软件著作权登记鉴别材料口径整理，正文页面保持连续文字行。",
    ] + lines
    all_lines = pad_document_lines(all_lines, lines_per_page, title)

    page_count = math.ceil(len(all_lines) / lines_per_page)
    for page_index in range(page_count):
        chunk = all_lines[page_index * lines_per_page : (page_index + 1) * lines_per_page]
        for line_index, line in enumerate(chunk):
            is_heading = (
                page_index == 0 and line_index == 0
            ) or line.startswith(("一、", "二、", "三、", "四、", "五、", "六、", "七、", "八、", "九、", "十、"))
            add_official_line(doc, line, bold=is_heading, size=11.5 if is_heading else 10.5)
        if page_index != page_count - 1:
            doc.add_page_break()
    doc.save(path)
    return page_count


def add_section(lines: list[str], title: str, items: list[str]) -> None:
    lines.append(title)
    lines.extend(items)


def build_manual_lines() -> list[str]:
    lines: list[str] = []
    add_section(lines, "一、软件概述", [
        "1. 本软件用于构建 AI 教育管家业务中的 Windows 主机控制台和平板终端协同系统。",
        "2. Windows 主机控制台面向管理员、装机人员和教育顾问使用。",
        "3. 平板终端面向家长和学生使用，界面隐藏复杂的初始化和 Agent 设置。",
        "4. 系统采用本地知识库目录保存学生学习资料、消化结果和 Markdown 学情档案。",
        "5. 默认学生资料根目录为 D:\\学生资料，各版本保持一致。",
        "6. Windows 主机控制台负责创建学生知识库、接收资料、浏览档案和管理设备。",
        "7. 平板终端负责连接主机、上传资料到主机、查看学情档案和联系教育管家。",
        "8. 系统支持局域网连接，也支持配置 Tailscale 地址作为远程连接备选。",
        "9. 系统通过统一任务协议支持 QClaw、OpenClaw、Codex CLI、Marvis 等 Agent 工具。",
        "10. 无直接执行接口的 Agent 可平滑降级为复制指令、人工执行和回执同步。",
    ])
    add_section(lines, "二、运行环境", [
        "1. Windows 主机建议使用 Windows 10 或 Windows 11 系统。",
        "2. Windows 主机需要具备可写入的 D 盘目录，默认创建 D:\\学生资料。",
        "3. Windows 端以 Electron 应用形式运行，包含 React 前端和 Node 主进程能力。",
        "4. 平板终端建议使用 Android 8.0 及以上版本。",
        "5. 平板终端需要允许相机、文件访问和网络访问权限。",
        "6. 局域网模式要求 Windows 主机和平板位于同一 Wi-Fi 或同一局域网段。",
        "7. 远程模式可配置 Tailscale 地址或手动输入远程主机地址。",
        "8. QClaw、OpenClaw、Codex CLI、Marvis 等 Agent 工具可按实际部署情况选装。",
    ])
    add_section(lines, "三、Windows 主机控制台启动", [
        "1. 将 Windows 发布包解压到固定目录，建议目录为 D:\\AI教育管家\\主机控制台。",
        "2. 双击启动 AI 教育管家控制台可执行文件。",
        "3. 首次启动后进入首页，默认处于本机独立模式。",
        "4. 本机独立模式用于单机创建知识库、导入资料和浏览档案。",
        "5. 需要平板上传资料时，在首页切换为主机-平板模式。",
        "6. 只有选择主机-平板模式后，主机服务模块才显示。",
        "7. 主机服务默认不自动启动，避免普通用户误开端口。",
        "8. 系统设置中可查看默认根目录、版本号、更新地址和诊断信息。",
        f"9. 若界面空白，需确认使用 Windows {WINDOWS_VERSION} 或更新版本，并重新启动应用。",
    ])
    add_section(lines, "四、创建标准新知识库", [
        "1. 进入初始化教育管家或新建教育智能体页面。",
        "2. 创建方式选择创建标准新知识库。",
        "3. 填写学生姓名、年级、学校和当前目标。",
        "4. 点击保存学生档案并初始化，不需要重复执行目录创建步骤。",
        "5. 系统在 D:\\学生资料 下创建学生知识库目录。",
        "6. 示例目录为 D:\\学生资料\\张三知识库。",
        "7. 系统写入 AGENT.md 文件。",
        "8. 系统创建张三原始资料库目录。",
        "9. 系统创建张三学情分析汇总目录。",
        "10. 系统创建输出结果目录。",
        "11. 单次保存同时写入 AGENT.md、知识目录、索引、日志和基础学情报告。",
        "12. 右侧 Agent 工具连接属于可选步骤，不再创建或覆盖知识库。",
        "13. 点击每个 Agent 步骤卡片即可复制对应指令。",
        "14. 工作规则优先使用逻辑路径和当前主机路径解析结果。",
        "15. 初始化失败时不保留无法使用的学生记录，并显示具体原因。",
    ])
    add_section(lines, "五、接管已有知识库", [
        "1. 若用户已经通过 QClaw 或其他 Agent 工具创建过知识库，可选择接管已有知识库。",
        "2. 接管过程不移动原文件。",
        "3. 接管过程不复制原文件。",
        "4. 接管过程不删除原目录。",
        "5. 用户填写学生姓名、年级、学校、当前目标。",
        "6. 用户选择已有知识库根目录。",
        "7. 用户选择 Agent 工具，包括 QClaw、Hohu、Marvis、OpenClaw。",
        "8. 用户选择 Agent 类型，包括子 Agent 或主对话普通对话。",
        "9. 用户填写 Agent 名称或会话备注。",
        "10. 系统自动扫描 AGENT.md、原始资料库、学情分析汇总和输出结果目录。",
        "11. 系统可识别原始资料、原始资料库、raw、materials、资料库等旧命名。",
        "12. 系统可识别学情分析汇总、汇总、summary、report、分析等旧命名。",
        "13. 系统可识别输出、输出结果、result 等旧命名。",
        "14. 未识别目录时，用户可手动指定。",
        "15. 缺少 AGENT.md 时，可点击写入标准 AGENT.md。",
        "16. 缺少原始资料库时，可点击创建原始资料库。",
        "17. 缺少学情分析汇总时，可点击创建学情分析汇总。",
        "18. 缺少输出结果时，可自动创建。",
        "19. 确认接管后，学生记录保存真实 rootPath、rawPath、summaryPath、agentPath 和 outputPath。",
        "20. 接管学生后续上传资料写入已有原始资料库。",
        "21. 接管学生后续查看档案读取已有学情分析汇总。",
        "22. 接管学生后续复制消化指令使用已有真实路径。",
    ])
    add_section(lines, "六、Agent 工具与统一任务中心", [
        "1. 系统以统一任务协议生成不同 Agent 工具可接收的任务。",
        "2. 具备接口的 Agent 可由适配器自动领取并执行任务。",
        "3. 不具备接口的 Agent 使用复制指令、人工粘贴、结果导入方式完成任务。",
        "4. OpenClaw 可直接执行受支持任务，QClaw 可使用任务收件箱。",
        "5. Codex CLI、Marvis 等工具可按人工执行模式使用。",
        "6. 所有任务统一记录状态、审批、权限、日志、超时和重试。",
        "7. 用户可在设置中一次关闭全部自动运行，切换为手动模式。",
        "8. 初始化页面提供分步骤指令。",
        "9. 点击步骤卡片会同时选择并复制对应指令。",
        "10. 点击高级按钮后可以查看并编辑当前步骤指令。",
        "11. 编辑后的内容优先复制，不再依赖右上角的小型复制按钮。",
        "12. 每日行动建议作为统一任务中心的首个自动化闭环。",
    ])
    add_section(lines, "七、主机服务与平板绑定", [
        "1. 在首页选择主机-平板模式后，可启动主机服务。",
        "2. 主机服务默认端口为 18777，可在设置中调整。",
        "3. 启动后显示局域网地址。",
        "4. 启动后显示 Tailscale 地址。",
        "5. 启动后显示当前连接模式。",
        "6. 启动后生成绑定二维码和临时配对码。",
        "7. 配对码默认十分钟过期。",
        "8. 平板扫码后提交配对码和设备名称。",
        "9. 主机返回 bearer token。",
        "10. 后续学生列表、档案读取和资料上传均使用 token 鉴权。",
        "11. 管理员可在主机端撤销设备。",
        "12. 撤销后平板再次访问会提示重新绑定。",
        "13. 管理员可设置设备可访问的学生范围。",
        "14. 设备可设置为访问全部学生或指定学生。",
    ])
    add_section(lines, "八、平板终端上传资料到主机", [
        "1. 平板终端首页提供上传资料到主机入口。",
        "2. 上传前需先选择学生。",
        "3. 可使用拍照上传。",
        "4. 可选择图片上传。",
        "5. 可选择下载文件上传。",
        "6. 可扫描 Downloads 最近文件上传。",
        "7. 可从文件管理器分享文件到平板终端上传。",
        "8. 上传由 Android 原生层直接 multipart POST 到 Windows 主机。",
        "9. 该设计避免 WebView 直接读取 content URI 的兼容问题。",
        "10. 上传成功后文件进入学生记录中的 rawPath。",
        "11. 标准学生 rawPath 位于 D:\\学生资料\\学生名知识库\\学生名原始资料库。",
        "12. 接管学生 rawPath 指向其已有原始资料库。",
        "13. 上传完成后主机记录上传日志。",
        "14. 上传完成后待消化数量增加。",
        "15. 上传失败时提示网络、权限、token 或文件选择器错误。",
    ])
    add_section(lines, "九、查看学情档案", [
        "1. Windows 端和平板端均可查看 Markdown 学情档案。",
        "2. 档案来源为学生记录中的 summaryPath。",
        "3. 标准学生 summaryPath 位于 D:\\学生资料\\学生名知识库\\学生名学情分析汇总。",
        "4. 接管学生 summaryPath 指向其已有学情分析汇总。",
        "5. 系统按资料摘要、综合汇总、问答精华、其他、全部文件分类显示。",
        "6. 分类只影响浏览层，不移动、不重命名真实文件。",
        "7. AGENT.md、log.md 和配置类文件默认在普通分类中隐藏。",
        "8. 全部文件用于查看真实 Markdown 文件树。",
        "9. 平板端支持离线缓存最近文档。",
        "10. 离线时先显示缓存文件列表和缓存正文。",
        "11. Windows 端提供显示或隐藏文档列表能力。",
        "12. 回到顶部按钮位于阅读区域底部浮动显示。",
    ])
    add_section(lines, "十、Agent 资料消化与覆盖复核", [
        "1. 上传资料后，主机端记录待消化数量。",
        "2. 待消化数量按学生和上传批次统计。",
        "3. 用户可复制资料消化指令。",
        "4. 用户将消化指令粘贴到所选 Agent 中执行，或由受支持适配器执行。",
        "5. Agent 按 AGENT.md 读取原始资料库并生成概念、实体、摘要、问答和综合汇总。",
        "6. 点击标记已提交后，资料从待提交消化转入等待 Agent 回执。",
        "7. Agent 写回 digest-state.json 或 digest-receipt.json 逐文件回执。",
        "8. 点击同步消化结果后，只有匹配回执的资料转为已处理。",
        "9. 可生成覆盖审计，对图片漏识别、低置信度和无逐文件回执资料发起二次核对。",
        "10. 同步复核结果后更新完整覆盖、失败、覆盖率及知识成果路径。",
    ])
    add_section(lines, "十一、联系教育管家", [
        "1. 平板端联系教育管家页面显示当前学生绑定方式。",
        "2. 支持企业微信绑定说明。",
        "3. 支持 QQ 绑定说明。",
        "4. 绑定企业微信时显示请在企业微信中联系 AI 教育管家。",
        "5. 绑定 QQ 时显示请在 QQ 中联系 AI 教育管家。",
        "6. 页面提供打开企业微信按钮。",
        "7. 页面提供打开 QQ 按钮。",
        "8. 页面提供复制咨询提示按钮。",
        "9. 咨询提示内容为 /咨询，我想咨询。",
        "10. 对话本身由外部通讯工具和用户选定的 Agent 工作流承载。",
    ])
    add_section(lines, "十二、备份、更新和维护", [
        "1. 建议装机完成后使用主机数据备份功能保存完整学生档案字段、设备授权和应用索引。",
        "2. 建议大量资料上传后备份 D:\\学生资料。",
        "3. 建议版本升级前备份主机应用数据目录。",
        "4. 更新清单文件为 edu-manager-version.json。",
        "5. Windows 和 Android 在同一更新清单中分别维护下载地址。",
        "6. Windows 版本号不应低于已有发布版本。",
        "7. 平板终端使用独立包名，不应升级为装机控制台 APK。",
        "8. 旧 Android 控制台保留为内部测试和装机辅助。",
        "9. 恢复备份后界面立即刷新学生、项目、文件资产和主机状态，无需重启。",
        "10. 应用启用单实例保护，升级时应关闭旧版本再启动新版本。",
        "11. 客户侧主推 AI教育管家平板终端。",
    ])
    add_section(lines, "十三、常见故障处理", [
        "1. Windows 启动空白时，先确认发布包包含 dist 目录和 index.html。",
        "2. 平板无法连接主机时，确认主机服务已启动。",
        "3. 平板无法连接主机时，确认局域网 IP 未变化。",
        "4. 平板无法连接主机时，确认 Windows 防火墙放行端口。",
        "5. 扫码失败时，可使用粘贴连接信息方式绑定。",
        "6. 文件选择器不可用时，可从文件管理器分享文件到平板终端。",
        "7. 相机不可用时，确认平板有相机应用且授予相机权限。",
        "8. 上传成功但 Agent 未见资料时，检查 rawPath、逻辑路径映射与 Agent 工作规则。",
        "9. 档案为空时，确认 Agent 已完成消化、写入回执并同步结果。",
        "10. 绑定 QQ 后仍显示企业微信提示时，刷新学生绑定信息。",
    ])
    add_section(lines, "十四、安全与权限说明", [
        "1. 第一版主机服务采用局域网 HTTP 加 bearer token。",
        "2. token 由扫码配对过程生成。",
        "3. token 只保存在已绑定设备中。",
        "4. 设备撤销后 token 不再有效。",
        "5. 平板只能访问被授权学生。",
        "6. 上传接口只写入授权学生的原始资料库。",
        "7. 档案接口只读取授权学生的学情分析汇总。",
        "8. 管理员应避免将绑定二维码长期公开展示。",
        "9. 远程连接建议配合可信网络或 Tailscale 使用。",
        "10. 系统不主动上传学生资料到第三方云端。",
    ])
    add_section(lines, "十五、学习项目与研究暂存层", [
        "1. 学习项目分为面向人的项目工作空间和面向 AI 的项目知识空间。",
        "2. 新建项目时可自定义工作空间文件夹，也可直接使用已有项目文件夹。",
        "3. 项目模板定义工作目录、知识策略、成长策略和成果要求。",
        "4. 工作空间中的候选资料先进入研究暂存层，不会自动污染知识空间。",
        "5. 资料经初筛、治理和人工确认后晋升为正式资产。",
        "6. 晋升资料以引用关系进入项目原始资料库，再由 Agent 执行知识消化。",
        "7. 项目支持编辑记录、重新定位、复制、导入导出、移除记录和恢复。",
        "8. 项目编辑不改动物理目录，移除记录不彻底删除项目文件。",
        "9. 多学生项目共享项目知识，并为每位学生形成独立成长证据。",
        "10. 项目归档前生成知识贡献申请，经审核后发布到成长模型。",
    ])
    add_section(lines, "十六、文件资产与屏幕资料采集", [
        "1. 文件资产中心以资产身份、版本、来源和引用关系管理资料。",
        "2. 学生筛选会联动资产总数、治理风险、七日曲线、列表和详情。",
        "3. 最近七日曲线分别统计每日新增资产和新增引用次数。",
        "4. Windows 支持全屏或指定窗口的限时连续屏幕采集。",
        "5. 采集策略包括智能混合、内容变化和固定间隔。",
        "6. Android 连续采集由用户授权启动并持续显示前台通知。",
        "7. 截图先进入候选采集箱，去重后由用户决定是否晋升。",
        "8. 候选截图不会未经审核直接写入项目知识空间。",
    ])
    return lines


def build_design_lines() -> list[str]:
    lines: list[str] = []
    add_section(lines, "一、设计目标", [
        "1. 本系统目标是形成 Windows 主机控制台和平板终端协同的 AI 教育管家工作流。",
        "2. Windows 主机承担管理员端、本地知识库管理端和本地服务端职责。",
        "3. Android 平板承担家长和学生用户端职责。",
        "4. 系统将复杂初始化、Agent 配置、目录管理和设备授权集中到 Windows 端。",
        "5. 系统将平板端简化为连接、上传、查看和联系四类核心功能。",
        "6. 系统要求标准知识库和接管知识库均可统一管理。",
        "7. 系统要求上传路径、档案路径和消化指令路径保持一致。",
        "8. 系统要求支持后续扩展多种 Agent 工具。",
    ])
    add_section(lines, "二、项目组成员及职责", [
        "1. 本软件由嘉玛蓝（北京）科技有限公司组织开发。",
        "2. 项目组成员信息用于说明软件开发过程中的主要参与人员和职责分工。",
        "3. 项目组成员信息不改变软件著作权人归属。",
        f"4. 软件著作权人仍为{OWNER}。",
        *[f"{index + 5}. {name}：{role}。" for index, (name, role) in enumerate(PROJECT_TEAM)],
        "10. 上述人员参与产品规划、功能设计、场景验证、测试反馈和交付验收等工作。",
        "11. 本节作为软件设计说明书中的开发组织与职责说明。",
    ])
    add_section(lines, "三、总体架构", [
        "1. 前端采用 React 组件化结构实现。",
        "2. Windows 端使用 Electron 外壳承载 React 应用。",
        "3. Electron 主进程负责本地文件、系统检测和 HTTP 服务。",
        "4. Electron preload 层提供受控 IPC 接口。",
        "5. Android 端使用 WebView 外壳承载同一套或复用的前端能力。",
        "6. Android 原生层负责文件选择、拍照、扫码和 multipart 上传。",
        "7. Windows 主机服务提供 REST API。",
        "8. 平板终端通过 HTTP API 访问学生列表、上传资料和读取档案。",
        "9. 学生知识库作为系统核心数据载体。",
        "10. Agent 工具负责执行资料消化和问答推理。",
        "11. 系统通过 AGENT.md 约束 Agent 对目录和文件的操作规则。",
        "12. 系统通过 students.json 维护学生索引。",
        "13. 系统通过设备记录维护 token、设备名称和授权范围。",
    ])
    add_section(lines, "四、主要模块设计", [
        "1. 首页模块负责显示运行模式、工具状态、快捷操作和主机服务入口。",
        "2. 初始化教育管家模块负责创建标准知识库或接管已有知识库。",
        "3. 新建教育智能体模块复用初始化流程，用于增加新的学生教育智能体。",
        "4. 资料收集与处理模块负责本机导入、待消化统计和消化指令辅助。",
        "5. 查看教育档案模块负责 Markdown 分类浏览和正文阅读。",
        "6. 教育管家问答模块负责打开 Agent 工具和复制咨询、消化提示。",
        "7. 统一任务中心负责管理 Agent 任务、人工任务、审批、日志、超时、重试和自动运行总开关。",
        "8. 系统设置模块负责根目录、版本、更新、皮肤和诊断。",
        "9. 主机服务模块负责启动 HTTP 服务、显示二维码和管理设备。",
        "10. 平板连接状态模块负责显示 serverUrl、token 状态和重连诊断。",
        "11. 平板上传模块负责拍照、选择文件、扫描 Downloads 和分享接收。",
        "12. 平板档案模块负责远程文件列表、分类过滤、Markdown 渲染和离线缓存。",
        "13. 平板联系模块负责展示企业微信或 QQ 绑定入口。",
    ])
    add_section(lines, "五、学生数据结构设计", [
        "1. 学生记录以唯一 studentId 标识。",
        "2. 学生记录保存学生姓名、年级、学校和当前目标。",
        "3. 学生记录保存 knowledgeBaseMode 字段。",
        "4. knowledgeBaseMode 取值为 standard 或 adopted。",
        "5. 学生记录保存 rootPath 字段。",
        "6. 学生记录保存 rawPath 字段。",
        "7. 学生记录保存 summaryPath 字段。",
        "8. 学生记录保存 agentPath 字段。",
        "9. 学生记录保存 outputPath 字段。",
        "10. 学生记录保存 agentTool 字段。",
        "11. agentTool 可取 qclaw、hohu、marvis、openclaw。",
        "12. 学生记录保存 agentBindingMode 字段。",
        "13. agentBindingMode 可取 subAgent 或 mainChat。",
        "14. 学生记录保存 agentName 和 agentNote。",
        "15. 接管学生保存 adoptedAt 时间。",
        "16. 旧版本学生加载时 knowledgeBaseMode 默认为 standard。",
        "17. 旧版本学生缺少路径字段时根据默认根目录补齐。",
    ])
    add_section(lines, "六、知识库路径设计", [
        "1. Windows 默认学生根目录为 D:\\学生资料。",
        "2. 标准知识库路径为 D:\\学生资料\\学生名知识库。",
        "3. 标准 AGENT.md 路径为 学生名知识库\\AGENT.md。",
        "4. 标准原始资料库路径为 学生名知识库\\学生名原始资料库。",
        "5. 标准学情分析汇总路径为 学生名知识库\\学生名学情分析汇总。",
        "6. 标准输出结果路径为 学生名知识库\\输出结果。",
        "7. 接管知识库不要求位于 D:\\学生资料。",
        "8. 接管知识库以用户选择的 rootPath 为准。",
        "9. 接管 rawPath 可由系统识别或用户手动指定。",
        "10. 接管 summaryPath 可由系统识别或用户手动指定。",
        "11. 上传资料始终读取学生记录 rawPath。",
        "12. 档案浏览始终读取学生记录 summaryPath。",
        "13. 消化指令始终读取学生记录 agentPath、rawPath 和 summaryPath。",
    ])
    add_section(lines, "七、接管已有知识库识别设计", [
        "1. 扫描根目录下是否存在 AGENT.md。",
        "2. 扫描根目录下是否存在学生名原始资料库。",
        "3. 兼容识别原始资料、原始资料库、raw、materials、资料库。",
        "4. 扫描根目录下是否存在学生名学情分析汇总。",
        "5. 兼容识别学情分析汇总、汇总、summary、report、分析。",
        "6. 扫描根目录下是否存在输出结果。",
        "7. 兼容识别输出、输出结果、result。",
        "8. 扫描 summaryPath 下是否存在 index.md。",
        "9. 扫描 summaryPath 下是否存在 log.md。",
        "10. 扫描结果以清单方式显示已找到、未找到、需选择或可创建。",
        "11. 缺少必要目录时提供创建按钮。",
        "12. 缺少 AGENT.md 时提供写入标准 AGENT.md 按钮。",
        "13. 覆盖已有 AGENT.md 前应提示备份。",
        "14. 确认接管只登记路径，不迁移、不复制、不删除。",
    ])
    add_section(lines, "八、Agent 工具能力表设计", [
        "1. 工具能力表避免在业务逻辑中写死 QClaw。",
        "2. QClaw 支持子 Agent、本地文件和定时任务。",
        "3. Hohu 支持子 Agent 和本地文件。",
        "4. Marvis 支持本地文件，但默认不支持子 Agent。",
        "5. OpenClaw 支持子 Agent、本地文件和定时任务。",
        "6. 工具能力表提供 personaTargetLabel。",
        "7. 工具能力表提供 memoryTargetLabel。",
        "8. 工具能力表提供 openLabel。",
        "9. 工具能力表提供下载地址。",
        "10. 初始化页面根据工具能力生成步骤和按钮。",
        "11. 教育管家问答页面根据工具能力显示打开工具和复制指令按钮。",
        "12. 接管完成提示根据工具能力区分子 Agent 和普通对话。",
    ])
    add_section(lines, "九、HTTP 服务 API 设计", [
        "1. GET /api/health 返回主机状态、版本、主机名和服务端口。",
        "2. GET /api/students 返回当前设备可访问学生列表。",
        "3. POST /api/students/{studentId}/materials 接收 multipart/form-data 文件。",
        "4. 上传接口将文件写入对应学生 rawPath。",
        "5. GET /api/students/{studentId}/archive/files 返回可浏览 Markdown 列表。",
        "6. 档案列表接口隐藏 AGENT.md、log.md 和配置类文件。",
        "7. GET /api/students/{studentId}/archive/file 读取单个 Markdown 正文。",
        "8. POST /api/pair/confirm 接收临时配对码和设备名。",
        "9. 配对成功后返回 bearer token。",
        "10. 学生和文件 API 均要求 Authorization: Bearer token。",
        "11. 错误响应包含明确 message 字段。",
        "12. token 失效时返回重新绑定提示。",
        "13. 端口占用时主机服务返回可读错误。",
    ])
    add_section(lines, "十、设备授权设计", [
        "1. 设备记录包含 deviceId。",
        "2. 设备记录包含设备名称。",
        "3. 设备记录包含 token 摘要或 token 存储信息。",
        "4. 设备记录包含绑定时间。",
        "5. 设备记录包含最近访问时间。",
        "6. 设备记录包含最近访问 IP。",
        "7. 设备记录包含客户端版本信息。",
        "8. 设备记录包含允许访问全部学生标记。",
        "9. 设备记录包含授权学生 ID 列表。",
        "10. 设备撤销后 token 立即失效。",
        "11. 新增学生时可按默认策略授权给设备。",
        "12. Windows 端提供撤销、重命名和范围调整操作。",
    ])
    add_section(lines, "十一、Android 原生能力设计", [
        "1. Android WebView 承载平板终端页面。",
        "2. 原生层提供扫码绑定主机能力。",
        "3. 原生层提供相机拍照能力。",
        "4. 原生层提供 ACTION_OPEN_DOCUMENT 文件选择能力。",
        "5. 原生层提供 Downloads 最近文件扫描能力。",
        "6. 原生层提供从其他 App 分享接收文件能力。",
        "7. 原生层将 content URI 转换为可上传流。",
        "8. 原生层直接向 Windows 主机发起 multipart POST。",
        "9. 原生层向 WebView 回传上传结果。",
        "10. 系统文件选择器不可用时提示从文件管理器分享。",
    ])
    add_section(lines, "十二、Markdown 浏览设计", [
        "1. Markdown 浏览器支持标题、段落、列表和代码块显示。",
        "2. 文件分类包括资料摘要、综合汇总、问答精华、其他和全部文件。",
        "3. index.md 默认归入其他分类。",
        "4. 包含综合库、学情、汇总、分析等关键词的文件归入综合汇总。",
        "5. 包含摘要、summary、digest 的文件归入资料摘要。",
        "6. 包含问答、QA、Q&A、对话、精华的文件归入问答精华。",
        "7. 无法识别或技术辅助类文件归入其他。",
        "8. 全部文件保持真实文件树视图。",
        "9. Windows 端可显示或隐藏文档列表。",
        "10. 平板端可缓存最近文件列表和正文。",
        "11. 离线时优先读取缓存正文。",
    ])
    add_section(lines, "十三、更新与发布设计", [
        "1. Windows 和 Android 发布物使用同一版本清单文件维护。",
        "2. Windows 下载地址使用 windowsUrl 字段。",
        "3. Android 平板终端下载地址使用 tabletTerminalUrl 或 apkUrl 字段。",
        "4. 旧 Android 控制台使用独立包名和更新通道。",
        "5. 平板终端包名为 com.qxmatrix.eduterminal。",
        "6. 旧控制台包名为 com.qxmatrix.edumanager。",
        f"7. Windows 版本 {WINDOWS_VERSION} 包含项目双空间、统一任务中心、屏幕采集、消化复核和文件资产统计。",
        f"8. 平板终端版本 {TABLET_TERMINAL_VERSION} 包含连续屏幕采集、设备授权闭环和连接备份导入恢复。",
        "9. 版本更新说明应记录新增功能、修复项和兼容性说明。",
    ])
    add_section(lines, "十四、异常处理设计", [
        "1. 主机服务未启动时平板显示连接失败说明。",
        "2. 局域网连接失败后可尝试 Tailscale 地址。",
        "3. token 失效时提示重新扫码绑定。",
        "4. 文件上传失败时显示文件名、学生和错误原因。",
        "5. 知识库路径不存在时提示管理员检查学生记录。",
        "6. rawPath 不存在时提示创建原始资料库。",
        "7. summaryPath 不存在时提示创建学情分析汇总。",
        "8. Markdown 正文读取失败时显示路径和权限提示。",
        "9. 工具未安装时显示下载入口。",
        "10. 打开外部工具失败时显示手动打开说明。",
    ])
    add_section(lines, "十五、安全设计", [
        "1. 本地资料默认保存在用户指定的 Windows 本机目录。",
        "2. HTTP 服务仅在用户主动启动主机服务后运行。",
        "3. 配对码短期有效。",
        "4. API 使用 bearer token 鉴权。",
        "5. token 与设备绑定。",
        "6. 管理员可撤销设备。",
        "7. 设备访问学生范围可控。",
        "8. 上传文件只进入授权学生 rawPath。",
        "9. 档案读取只来自授权学生 summaryPath。",
        "10. 远程连接模式由用户显式配置。",
    ])
    add_section(lines, "十六、学习项目双空间与资产设计", [
        "1. 学习项目由项目记录、项目工作空间和项目知识空间组成。",
        "2. 项目工作空间面向学生和教师，目录可按模板创建、逐项自定义或绑定已有文件夹。",
        "3. 项目知识空间面向 AI，统一使用原始资料、概念、实体、摘要、问答精华和综合汇总结构。",
        "4. 工作空间文件不直接复制到知识空间，而是先进入研究暂存层。",
        "5. 暂存资料经过初筛、重复识别、来源治理和人工选择后晋升为正式资产。",
        "6. 正式资产通过引用关系进入项目原始资料库，并保留来源、版本和关联学生。",
        "7. 项目支持编辑记录、重新定位、复制、导入导出、移除记录和恢复记录。",
        "8. 项目编辑不修改物理目录，移除记录不删除项目文件。",
        "9. 多学生项目共享项目知识，但按学生建立独立成长证据。",
        "10. 项目归档通过知识贡献申请、审核、发布和审计完成。",
    ])
    add_section(lines, "十七、统一任务中心与 Agent 适配设计", [
        "1. 所有自动任务和人工任务使用统一任务状态协议。",
        "2. 任务记录输入、输出、执行 Agent、权限、审批、日志、超时、重试和审核结果。",
        "3. Agent 执行适配器把统一任务转换为不同工具的执行方式。",
        "4. OpenClaw 对受支持任务采用直接执行方式。",
        "5. QClaw 采用任务收件箱方式接收任务。",
        "6. Codex CLI、Marvis 或无接口工具采用复制指令和人工回填方式。",
        "7. 自动运行总开关关闭后，自动触发只生成待办，不调用 Agent。",
        "8. 新资料、项目阶段变化和定时规则可创建增量处理任务。",
        "9. 每日行动建议使用严格结构化数据，并经审核后发布到学情报告。",
    ])
    add_section(lines, "十八、资料消化质量与文件资产统计设计", [
        "1. 资料状态区分待提交消化、等待 Agent 回执、已处理、失败和需复核。",
        "2. Agent 通过 digest-state.json 或 digest-receipt.json 写回完成证据。",
        "3. 同步操作仅对匹配文件身份和批次的回执更新状态。",
        "4. 覆盖审计按文件检查完整覆盖、部分识别、失败、缺少来源和缺少逐文件回执。",
        "5. 二次核对对图片执行独立视觉识别和 OCR，并补充知识成果路径。",
        "6. 文件资产中心按资产身份、文件指纹、版本、来源和引用关系组织数据。",
        "7. 最近七日统计按本地自然日计算新增资产和唯一新增引用。",
        "8. 学生筛选联动资产总数、风险、治理候选、七日趋势、列表和详情。",
        "9. 跨项目概念、实体和能力证据通过统一身份和关系记录减少知识孤岛。",
    ])
    return lines


def build_team_lines() -> list[str]:
    lines: list[str] = []
    add_section(lines, "一、说明目的", [
        "1. 本说明用于记录 AI教育管家主机控制台与平板终端系统项目组主要参与人员。",
        "2. 本说明可作为公司内部留档、代理机构沟通和软著申报辅助说明材料。",
        "3. 本说明不替代中国版权保护中心统一的软件著作权登记申请表。",
        "4. 本说明不作为源程序鉴别材料的一部分。",
        "5. 本说明不改变软件著作权归属。",
        f"6. 本软件著作权人建议填写为{OWNER}。",
        "7. 申请表、源程序鉴别材料和文档鉴别材料中的软件名称和版本号应保持一致。",
        "8. 如代理机构另有格式要求，可在不改变事实内容的前提下调整表格样式。",
    ])
    add_section(lines, "二、软件基本信息", [
        f"1. 软件名称：{SOFTWARE_NAME}。",
        f"2. 版本号：{VERSION}。",
        f"3. 著作权人：{OWNER}。",
        "4. 软件类型：应用软件。",
        f"5. Windows 主机控制台版本：{WINDOWS_VERSION}。",
        f"6. Android 平板终端版本：{TABLET_TERMINAL_VERSION}。",
        "7. 运行环境：Windows 主机端与 Android 平板终端。",
        "8. 主要用途：学生资料收集、AI 教育管家知识库管理、学情档案浏览和主机平板协同。",
        "9. 默认资料目录：D:\\学生资料。",
        "10. 项目开发方式：公司组织开发。",
        "11. 项目交付形态：Windows 主机控制台、Android 平板终端和相关本地服务。",
    ])
    add_section(lines, "三、项目组成员及职责", [
        *[f"{index + 1}. {name}：{role}。" for index, (name, role) in enumerate(PROJECT_TEAM)],
        "6. 项目组成员围绕产品需求、业务流程、技术实现、用户测试和交付验收共同参与。",
        "7. 项目组成员信息用于说明开发参与情况，不表示个人作为共同著作权人申报。",
        "8. 若未来确需以个人或多人共同著作权人方式申报，应另行确认权属协议和申请表填写方式。",
    ])
    add_section(lines, "四、权属说明建议", [
        f"1. 本软件由{OWNER}组织开发并负责产品化交付。",
        f"2. 建议软件著作权登记申请表中的著作权人填写为{OWNER}。",
        "3. 项目组成员作为公司组织开发过程中的参与人员记录。",
        "4. 若存在劳动合同、委托开发合同、项目任务书或内部立项文件，应与本说明共同留档。",
        "5. 若登记机构或代理机构要求补充证明，可提供公司营业执照复印件并加盖公章。",
        "6. 若涉及外部委托开发或第三方许可，应另行准备合同、授权证明或许可证明。",
        "7. 本项目当前材料按公司作为单一著作权人的口径整理。",
    ])
    add_section(lines, "五、申报材料放置建议", [
        "1. 项目组成员信息已写入软件设计说明书中的项目组成员及职责章节。",
        "2. 用户操作手册不建议放置详细项目组成员信息。",
        "3. 源程序鉴别材料不建议插入项目组成员说明。",
        "4. 本独立说明可作为辅助材料由公司内部保存。",
        "5. 如代理机构要求提交，可随相关证明文件一并提供。",
        "6. 正式提交时应以登记系统生成的申请表为准。",
    ])
    return lines


def build_application_info_lines() -> list[str]:
    lines: list[str] = []
    add_section(lines, "一、文件用途", [
        "1. 本文件用于整理计算机软件著作权登记申请表的填写信息。",
        "2. 本文件不是中国版权保护中心正式申请表。",
        "3. 正式申请表应在登记系统中在线填写、确认、打印并签章。",
        "4. 本文件可交由公司经办人或代理机构照此转填。",
        "5. 本文件中的待确认项应在正式提交前核实。",
    ])
    add_section(lines, "二、软件基本信息", [
        f"1. 软件全称：{SOFTWARE_NAME}。",
        "2. 软件简称：AI教育管家。",
        f"3. 版本号：{VERSION}。",
        "4. 软件分类：应用软件。",
        "5. 行业领域：教育信息化、学习资料管理、人工智能辅助教育。",
        "6. 开发方式建议填写：独立开发。",
        "7. 权利取得方式建议填写：原始取得。",
        "8. 权利范围建议填写：全部权利。",
        "9. 发表状态：请确认填写未发表或已发表。",
        "10. 开发完成日期：请确认填写 2026年07月06日 或实际完成日期。",
        "11. 首次发表日期：如未发表则不填；如已提供下载或交付客户，应填写实际首次发表日期。",
        "12. 软件用途：用于学生资料采集、项目制学习知识沉淀、成长档案管理和主机平板协同。",
        "13. 主要功能：文件资产管理、项目双空间、LLM Wiki 知识加工、统一任务中心、消化覆盖审计、成长模型、屏幕采集和设备授权。",
        f"14. 版本构成：Windows 主机控制台 {WINDOWS_VERSION}，Android 平板终端 {TABLET_TERMINAL_VERSION}。",
    ])
    add_section(lines, "三、著作权人信息", [
        f"1. 著作权人名称：{OWNER}。",
        "2. 著作权人类型：企业法人。",
        "3. 统一社会信用代码：待填写。",
        "4. 注册地址：待填写。",
        "5. 联系地址：待填写。",
        "6. 联系人：待填写。",
        "7. 联系电话：待填写。",
        "8. 电子邮箱：待填写。",
        "9. 证件材料：营业执照副本复印件并加盖公章。",
    ])
    add_section(lines, "四、技术特点信息", [
        "1. 客户端形态：Windows Electron 主机控制台、Android WebView 平板终端。",
        "2. 前端技术：React、TypeScript、Vite、CSS。",
        "3. 桌面端技术：Electron、Node.js、本地文件系统、HTTP 服务。",
        "4. Android 技术：Java、WebView、Intent 文件选择、相机、扫码、multipart 上传。",
        "5. 数据存储：本地 JSON 索引、Windows 本机学生知识库目录、Markdown 文档。",
        "6. 默认资料根目录：D:\\学生资料。",
        "7. 支持工具：通过统一任务协议和 Agent 适配器支持 QClaw、OpenClaw、Codex CLI、Marvis 等工具。",
        "8. 网络方式：局域网 HTTP 服务、bearer token 鉴权、可选 Tailscale 远程连接。",
        "9. 代码语言：TypeScript、JavaScript、Java、CSS、HTML。",
        "10. 运行环境：Windows 10/11 主机，Android 8.0 及以上平板终端。",
        "11. 源程序量：以实际提交源程序鉴别材料为准，当前估算源码超过 60 页。",
    ])
    add_section(lines, "五、申请材料对应关系", [
        "1. 官方申请表：由登记系统在线生成，使用本草稿转填。",
        "2. 文档鉴别材料：用户操作手册或软件设计说明书。",
        "3. 源程序鉴别材料：源程序前 30 页和后 30 页。",
        "4. 证明文件：营业执照副本复印件并加盖公章。",
        "5. 辅助说明：项目组成员及职责说明、公司组织开发及权属说明、原创性与真实性声明。",
        "6. 如代理办理：另需代理委托协议或代理机构要求的其他文件。",
    ])
    return lines


def build_ownership_lines() -> list[str]:
    lines: list[str] = []
    add_section(lines, "一、说明事项", [
        f"1. {SOFTWARE_NAME} {VERSION} 由{OWNER}组织开发。",
        "2. 本说明用于记录软件组织开发情况和著作权归属口径。",
        "3. 本说明可作为公司内部留档材料。",
        "4. 本说明可根据代理机构意见作为软著申报补充证明材料。",
        "5. 本说明不替代官方申请表和营业执照复印件。",
    ])
    add_section(lines, "二、组织开发情况", [
        "1. 公司根据 AI 教育管家产品部署、交付和运营需要组织本软件开发。",
        "2. 软件围绕 Windows 主机控制台和平板终端协同使用场景进行设计。",
        "3. 软件开发内容包括前端界面、Electron 主进程、Android 原生壳、本地 HTTP 服务和文档浏览能力。",
        "4. 软件开发过程包括需求梳理、功能设计、编码实现、双端联调、客户场景测试和版本打包。",
        "5. 项目组成员按照产品规划、开发实现、流程测试和交付验证等职责参与工作。",
        "6. 项目代码、文档和构建产物由公司统一管理。",
        "7. 项目当前已使用 Git 进行版本管理并建立私有仓库。",
        f"8. 本次申请材料对应 Windows 主机控制台 {WINDOWS_VERSION} 和 Android 平板终端 {TABLET_TERMINAL_VERSION}。",
    ])
    add_section(lines, "三、权属说明", [
        f"1. 本软件著作权登记建议以{OWNER}作为著作权人申报。",
        "2. 项目组成员为公司组织开发过程中的参与人员。",
        "3. 项目组成员名单不表示个人作为共同著作权人申报。",
        "4. 如未来改变著作权归属或增加共同著作权人，应另行确认书面协议。",
        "5. 若存在劳动合同、项目任务书、内部立项文件或验收文件，应与本说明共同归档。",
        "6. 若登记机构或代理机构要求，可补充公司营业执照复印件并加盖公章。",
        "7. 若软件包含第三方开源组件，第三方组件权利仍按相应许可协议处理。",
    ])
    add_section(lines, "四、项目组人员", [
        *[f"{index + 1}. {name}：{role}。" for index, (name, role) in enumerate(PROJECT_TEAM)],
        "6. 上述人员参与不改变公司作为申请著作权人的申报口径。",
    ])
    add_section(lines, "五、签章栏", [
        f"1. 著作权人：{OWNER}。",
        "2. 经办人签字：____________________。",
        "3. 日期：________年____月____日。",
        "4. 公司盖章处：",
        "5. ",
        "6. ",
    ])
    return lines


def build_originality_lines() -> list[str]:
    lines: list[str] = []
    add_section(lines, "一、声明对象", [
        f"1. 软件名称：{SOFTWARE_NAME}。",
        f"2. 版本号：{VERSION}。",
        f"3. 声明主体：{OWNER}。",
        "4. 声明用途：软件著作权登记辅助说明材料。",
    ])
    add_section(lines, "二、真实性声明", [
        "1. 本次准备的源程序鉴别材料来源于当前软件项目源码。",
        "2. 本次准备的文档鉴别材料来源于当前软件功能、设计和操作流程。",
        "3. 软件名称、版本号和著作权人已在材料中保持一致。",
        "4. 项目组成员及职责说明反映项目实际参与情况。",
        "5. 申请表填写信息草稿仅用于转填官方申请表，正式内容以在线申请表为准。",
        "6. 材料中包含的待确认事项应在正式提交前由申请人核实。",
    ])
    add_section(lines, "三、原创性声明", [
        "1. 本软件核心功能由项目组围绕 AI 教育管家业务需求设计和实现。",
        "2. 本软件包括 Windows 主机控制台、Android 平板终端、本地服务、设备配对和档案浏览等功能。",
        "3. 本软件源代码包含 React、Electron、Android Java 和本地服务相关实现。",
        "4. 本软件不以复制他人软件源代码作为主要开发方式。",
        "5. 如软件中使用开源库或第三方运行环境，其权利归属和许可条件依照对应开源协议或授权文件处理。",
        "6. 本软件申请保护范围不包括第三方开源库、系统组件、通用运行环境或第三方工具本身。",
        "7. 本软件申请保护范围主要为项目组原创实现的业务流程、界面组织、本地服务和双端协同代码。",
    ])
    add_section(lines, "四、一致性声明", [
        "1. 正式提交时，申请表、源程序鉴别材料和文档鉴别材料的软件名称应保持一致。",
        "2. 正式提交时，申请表、源程序鉴别材料和文档鉴别材料的版本号应保持一致。",
        "3. 正式提交时，著作权人名称应与营业执照登记名称保持一致。",
        "4. 正式提交时，纸质材料应按要求使用 A4 纸张打印。",
        "5. 正式提交时，需签章的文件应由著作权人统一签章。",
    ])
    add_section(lines, "五、签章栏", [
        f"1. 声明单位：{OWNER}。",
        "2. 经办人签字：____________________。",
        "3. 日期：________年____月____日。",
        "4. 公司盖章处：",
        "5. ",
        "6. ",
    ])
    return lines


def build_package_checklist_lines() -> list[str]:
    lines: list[str] = []
    add_section(lines, "一、官方必备材料", [
        "1. 计算机软件著作权登记申请表：需在中国版权保护中心系统在线填写并打印。",
        "2. 软件鉴别材料之一：源程序鉴别材料。",
        "3. 软件鉴别材料之二：文档鉴别材料，可使用用户操作手册或软件设计说明书。",
        "4. 相关证明文件：企业法人营业执照副本复印件并加盖公章。",
        "5. 如委托代理机构办理：代理委托协议或代理机构要求的授权材料。",
        "6. 如存在委托开发、合作开发或权利转让：对应合同、协议或权属证明。",
        "7. 如基于原有软件继续开发：原软件著作权人许可证明或相关授权文件。",
    ])
    add_section(lines, "二、当前已准备文件", [
        f"1. 01_用户操作手册_AI教育管家主机控制台与平板终端系统_{VERSION}.docx。",
        f"2. 02_软件设计说明书_AI教育管家主机控制台与平板终端系统_{VERSION}.docx。",
        f"3. 03_源程序鉴别材料_AI教育管家主机控制台与平板终端系统_{VERSION}.docx。",
        f"4. 04_项目组成员及职责说明_AI教育管家主机控制台与平板终端系统_{VERSION}.docx。",
        f"5. 05_申请表填写信息草稿_AI教育管家主机控制台与平板终端系统_{VERSION}.docx。",
        f"6. 06_公司组织开发及权属说明_AI教育管家主机控制台与平板终端系统_{VERSION}.docx。",
        f"7. 07_原创性与真实性声明_AI教育管家主机控制台与平板终端系统_{VERSION}.docx。",
        f"8. 08_申请材料目录与提交检查清单_AI教育管家主机控制台与平板终端系统_{VERSION}.docx。",
    ])
    add_section(lines, "三、仍需人工补充或确认", [
        "1. 官方登记系统在线生成的计算机软件著作权登记申请表。",
        "2. 嘉玛蓝（北京）科技有限公司营业执照副本复印件。",
        "3. 营业执照复印件加盖公司公章。",
        "4. 统一社会信用代码、注册地址、联系人、联系电话、邮箱等申请表信息。",
        "5. 开发完成日期。",
        "6. 首次发表状态和首次发表日期。",
        "7. 是否委托代理机构办理。",
        "8. 如委托代理机构办理，补充代理委托材料。",
        "9. 是否存在外部委托、合作开发或权利转让事实。",
        "10. 如存在上述事实，补充相应合同或权属文件。",
    ])
    add_section(lines, "四、打印与格式检查", [
        "1. 所有纸质申请文件建议使用 A4 纸张。",
        "2. 源程序和文档鉴别材料建议黑白打印。",
        "3. 源程序材料每页不少于 50 行。",
        "4. 文档材料每页不少于 30 行。",
        "5. 软件名称应与申请表保持一致。",
        "6. 版本号应与申请表保持一致。",
        "7. 页眉中的软件名称和版本号应与申请表保持一致。",
        "8. 需要签章的文件签章名称应与申请表中的著作权人名称一致。",
        "9. 打印后检查页码是否连续。",
        "10. 打印后检查是否存在乱码、空白页、重页或缺页。",
    ])
    add_section(lines, "五、建议提交组合", [
        "1. 官方申请表。",
        "2. 源程序鉴别材料。",
        "3. 文档鉴别材料，可优先选择软件设计说明书。",
        "4. 营业执照副本复印件并加盖公章。",
        "5. 代理委托材料，如委托办理。",
        "6. 其他权属证明，如实际情况需要。",
        "7. 项目组成员及职责说明、权属说明、原创性声明可作为辅助留档或按代理机构要求提交。",
    ])
    return lines


def collect_source_lines() -> tuple[list[str], int, int]:
    source_files = [
        "src/main.tsx",
        "src/styles.css",
        "electron/main.cjs",
        "electron/preload.cjs",
        "electron/asset-statistics.cjs",
        "electron/digest-receipt.cjs",
        "electron/capture-protocol.cjs",
        "electron/task-protocol.cjs",
        "android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java",
        "android-lite/src/com/qxmatrix/edumanager/MainActivity.java",
        "android-tablet-terminal/AndroidManifest.xml",
        "android-lite/AndroidManifest.xml",
        "capacitor.config.ts",
        "vite.config.ts",
        "package.json",
    ]
    lines: list[str] = []
    for rel in source_files:
        path = ROOT / rel
        if not path.exists():
            continue
        lines.append(f"// ===== 文件：{rel} =====")
        text = path.read_text(encoding="utf-8", errors="replace")
        for raw_line in text.splitlines():
            lines.append(raw_line.replace("\t", "    "))
        lines.append(f"// ===== 文件结束：{rel} =====")
        lines.append("")

    lines_per_page = 50
    total_pages = math.ceil(len(lines) / lines_per_page)
    if total_pages > 60:
        selected = lines[: 30 * lines_per_page] + lines[-30 * lines_per_page :]
        selected_pages = 60
    else:
        selected = lines
        selected_pages = total_pages
    selected = pad_to_multiple(selected, lines_per_page, "// 源程序鉴别材料")
    return selected, total_pages, selected_pages


def write_source_doc(path: Path) -> tuple[int, int]:
    selected_lines, original_pages, selected_pages = collect_source_lines()
    doc = Document()
    configure_page(doc)
    doc.styles["Normal"].font.name = CODE_FONT
    doc.styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), CODE_FONT)

    lines_per_page = 50
    page_count = math.ceil(len(selected_lines) / lines_per_page)
    for page_index in range(page_count):
        if original_pages > 60 and page_index == 30:
            section = doc.add_section(WD_SECTION.NEW_PAGE)
            section.page_width = Inches(8.27)
            section.page_height = Inches(11.69)
            section.top_margin = Inches(0.72)
            section.bottom_margin = Inches(0.72)
            section.left_margin = Inches(0.78)
            section.right_margin = Inches(0.78)
            section.header_distance = Inches(0.28)
            section.footer_distance = Inches(0.28)
            header = section.header.paragraphs[0]
            header.text = f"{SOFTWARE_NAME} {VERSION} 源程序鉴别材料（后30页）"
            header.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in header.runs:
                set_run_font(run, 9, False)
            footer = section.footer.paragraphs[0]
            footer.text = COPYRIGHT_LINE + "    "
            footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
            add_page_number(footer)
            for run in footer.runs:
                set_run_font(run, 9, False)
        elif page_index != 0:
            doc.add_page_break()
        chunk = selected_lines[page_index * lines_per_page : (page_index + 1) * lines_per_page]
        for line_number, line in enumerate(chunk, start=1):
            add_code_line(doc, f"{page_index + 1:02d}-{line_number:02d}  {line[:150]}")
    doc.save(path)
    return original_pages, page_count


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manual_path = OUT_DIR / f"01_用户操作手册_{SOFTWARE_NAME}_{VERSION}.docx"
    design_path = OUT_DIR / f"02_软件设计说明书_{SOFTWARE_NAME}_{VERSION}.docx"
    source_path = OUT_DIR / f"03_源程序鉴别材料_{SOFTWARE_NAME}_{VERSION}.docx"
    team_path = OUT_DIR / f"04_项目组成员及职责说明_{SOFTWARE_NAME}_{VERSION}.docx"
    application_info_path = OUT_DIR / f"05_申请表填写信息草稿_{SOFTWARE_NAME}_{VERSION}.docx"
    ownership_path = OUT_DIR / f"06_公司组织开发及权属说明_{SOFTWARE_NAME}_{VERSION}.docx"
    originality_path = OUT_DIR / f"07_原创性与真实性声明_{SOFTWARE_NAME}_{VERSION}.docx"
    checklist_path = OUT_DIR / f"08_申请材料目录与提交检查清单_{SOFTWARE_NAME}_{VERSION}.docx"

    manual_pages = write_line_doc(
        manual_path,
        "用户操作手册",
        "软件著作权登记文档鉴别材料",
        build_manual_lines(),
        30,
    )
    design_pages = write_line_doc(
        design_path,
        "软件设计说明书",
        "软件著作权登记文档鉴别材料",
        build_design_lines(),
        30,
    )
    original_source_pages, source_pages = write_source_doc(source_path)
    team_pages = write_line_doc(
        team_path,
        "项目组成员及职责说明",
        "软件著作权登记辅助说明材料",
        build_team_lines(),
        30,
    )
    application_info_pages = write_line_doc(
        application_info_path,
        "申请表填写信息草稿",
        "软件著作权登记申请表转填辅助材料",
        build_application_info_lines(),
        30,
    )
    ownership_pages = write_line_doc(
        ownership_path,
        "公司组织开发及权属说明",
        "软件著作权登记辅助证明材料",
        build_ownership_lines(),
        30,
    )
    originality_pages = write_line_doc(
        originality_path,
        "原创性与真实性声明",
        "软件著作权登记辅助声明材料",
        build_originality_lines(),
        30,
    )
    checklist_pages = write_line_doc(
        checklist_path,
        "申请材料目录与提交检查清单",
        "软件著作权登记材料包核对文件",
        build_package_checklist_lines(),
        30,
    )

    summary = {
        "softwareName": SOFTWARE_NAME,
        "version": VERSION,
        "windowsVersion": WINDOWS_VERSION,
        "tabletTerminalVersion": TABLET_TERMINAL_VERSION,
        "owner": OWNER,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "manual": {"path": str(manual_path), "pages": manual_pages, "linesPerPage": 30},
        "design": {"path": str(design_path), "pages": design_pages, "linesPerPage": 30},
        "source": {
            "path": str(source_path),
            "originalEstimatedPagesAt50Lines": original_source_pages,
            "submittedPages": source_pages,
            "linesPerPage": 50,
            "selection": "原始源程序超过60页，已按前30页和后30页生成连续鉴别材料。",
        },
        "team": {"path": str(team_path), "pages": team_pages, "linesPerPage": 30},
        "applicationInfo": {"path": str(application_info_path), "pages": application_info_pages, "linesPerPage": 30},
        "ownership": {"path": str(ownership_path), "pages": ownership_pages, "linesPerPage": 30},
        "originality": {"path": str(originality_path), "pages": originality_pages, "linesPerPage": 30},
        "checklist": {"path": str(checklist_path), "pages": checklist_pages, "linesPerPage": 30},
    }
    (OUT_DIR / "生成说明.md").write_text(
        "# 软件著作权登记材料生成说明\n\n"
        f"- 软件名称：{SOFTWARE_NAME}\n"
        f"- 版本号：{VERSION}\n"
        f"- Windows 主机控制台版本：{WINDOWS_VERSION}\n"
        f"- Android 平板终端版本：{TABLET_TERMINAL_VERSION}\n"
        f"- 著作权人：{OWNER}\n"
        f"- 生成时间：{summary['generatedAt']}\n"
        f"- 用户操作手册：{manual_pages} 页，每页按不少于 30 行组织。\n"
        f"- 软件设计说明书：{design_pages} 页，每页按不少于 30 行组织。\n"
        f"- 源程序鉴别材料：源程序按每页 50 行估算共 {original_source_pages} 页，提交材料为 {source_pages} 页。\n"
        f"- 项目组成员及职责说明：{team_pages} 页，每页按不少于 30 行组织；作为辅助说明材料，不替代申请表。\n"
        f"- 申请表填写信息草稿：{application_info_pages} 页，用于转填官方在线申请表。\n"
        f"- 公司组织开发及权属说明：{ownership_pages} 页，用于公司组织开发和权属口径留档。\n"
        f"- 原创性与真实性声明：{originality_pages} 页，用于材料真实性和原创性辅助说明。\n"
        f"- 申请材料目录与提交检查清单：{checklist_pages} 页，用于提交前核对材料包。\n"
        "- 源程序取材范围：src、electron、android-tablet-terminal、android-lite、配置入口文件；不包含 node_modules、dist、release、第三方库和二进制产物。\n"
        "- 尚需人工补充：官方登记系统生成的申请表、营业执照副本复印件加盖公章、代理委托材料（如委托办理）。\n"
        "- 版式：A4 页面，页眉标注软件名称和版本，页脚标注著作权人版权信息和页码。\n",
        encoding="utf-8",
    )
    (OUT_DIR / "生成说明.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    package_path = OUT_DIR / f"AI教育管家软著申请材料包_{VERSION}.zip"
    package_files = [
        manual_path,
        design_path,
        source_path,
        team_path,
        application_info_path,
        ownership_path,
        originality_path,
        checklist_path,
        OUT_DIR / "09_待补充材料说明.md",
        OUT_DIR / "生成说明.md",
        OUT_DIR / "生成说明.json",
    ]
    with ZipFile(package_path, "w", ZIP_DEFLATED) as package:
        for file_path in package_files:
            if file_path.exists():
                package.write(file_path, arcname=file_path.name)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
