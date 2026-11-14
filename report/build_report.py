from pathlib import Path
import runpy

# 默认构建入口已升级为 16 章实现级报告。保留下方旧脚本仅用于历史对照，
# 正常执行本文件时不会再生成旧版内容。
runpy.run_path(str(Path(__file__).with_name("build_report_expanded.py")), run_name="__main__")
raise SystemExit(0)
from datetime import date
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = ROOT / "report"
ASSET_DIR = REPORT_DIR / "assets"
OUTPUT = REPORT_DIR / "实验1B安全文件传输系统实验报告.docx"
ASSET_DIR.mkdir(parents=True, exist_ok=True)

NAVY = "183A31"
GREEN = "0F6A4D"
PALE = "EFF6F2"
LIGHT = "F5F7F6"
GRAY = "D9D9D9"
TEXT = RGBColor(28, 37, 34)


def font(size, bold=False):
    path = Path("C:/Windows/Fonts/msyh.ttc")
    return ImageFont.truetype(str(path), size=size, index=0) if path.exists() else ImageFont.load_default()


def box(draw, xy, text, fill, outline=NAVY, text_fill="#FFFFFF", radius=18, title_size=28):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=f"#{outline}", width=3)
    x1, y1, x2, y2 = xy
    lines = text.split("\n")
    f = font(title_size)
    line_h = title_size + 10
    start = (y1 + y2 - line_h * len(lines)) / 2
    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=f)
        draw.text(((x1 + x2 - (bbox[2] - bbox[0])) / 2, start + i * line_h), line, font=f, fill=text_fill)


def arrow(draw, start, end, color="#40685B", width=5):
    draw.line([start, end], fill=color, width=width)
    import math
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    length = 16
    for offset in (2.55, -2.55):
        point = (end[0] + length * math.cos(angle + offset), end[1] + length * math.sin(angle + offset))
        draw.line([end, point], fill=color, width=width)


def make_architecture():
    image = Image.new("RGB", (1600, 760), "white")
    draw = ImageDraw.Draw(image)
    box(draw, (70, 235, 370, 485), "Vue 客户端\nWeb Crypto", "#0F6A4D")
    box(draw, (510, 120, 900, 335), "HTTPS API\n认证与文件管理", "#183A31")
    box(draw, (510, 425, 900, 640), "WSS 长连接\nSFT Protocol V1", "#183A31")
    box(draw, (1040, 80, 1510, 285), "SQLite\n账户 元数据 审计", "#4D6D63")
    box(draw, (1040, 430, 1510, 635), "隔离文件存储\nUUID 文件名 临时区", "#4D6D63")
    arrow(draw, (370, 315), (510, 225)); arrow(draw, (510, 275), (370, 365))
    arrow(draw, (370, 420), (510, 520)); arrow(draw, (510, 570), (370, 465))
    arrow(draw, (900, 220), (1040, 185)); arrow(draw, (1040, 235), (900, 280))
    arrow(draw, (900, 520), (1040, 520)); arrow(draw, (1040, 580), (900, 580))
    draw.text((600, 52), "Sentinel Transfer 系统架构", font=font(34), fill="#17201D")
    path = ASSET_DIR / "architecture.png"; image.save(path, quality=95); return path


def make_protocol_frame():
    image = Image.new("RGB", (1600, 500), "white")
    draw = ImageDraw.Draw(image)
    draw.text((70, 45), "SFT 二进制帧格式", font=font(36), fill="#17201D")
    y1, y2 = 180, 360
    widths = [280, 570, 610]
    labels = [("Header Length", "4 字节 大端"), ("JSON Header", "版本 类型 请求编号 偏移 哈希"), ("Binary Payload", "最大 4 MiB 原始文件数据")]
    x = 70
    colors = ["#D9E8E1", "#9FC6B5", "#183A31"]
    for w, (top, bottom), color in zip(widths, labels, colors):
        draw.rectangle((x, y1, x + w, y2), fill=color, outline="#294F43", width=3)
        text_color = "#FFFFFF" if color == "#183A31" else "#17201D"
        draw.text((x + 18, y1 + 38), top, font=font(27), fill=text_color)
        draw.text((x + 18, y1 + 98), bottom, font=font(19), fill=text_color)
        x += w
    path = ASSET_DIR / "protocol-frame.png"; image.save(path, quality=95); return path


def make_sequence():
    image = Image.new("RGB", (1500, 1100), "white")
    draw = ImageDraw.Draw(image)
    draw.text((485, 35), "可恢复上传时序", font=font(36), fill="#17201D")
    box(draw, (140, 110, 450, 230), "Client", "#0F6A4D", title_size=30)
    box(draw, (1040, 110, 1350, 230), "Server", "#183A31", title_size=30)
    draw.line((295, 230, 295, 1030), fill="#9EADA7", width=3)
    draw.line((1195, 230, 1195, 1030), fill="#9EADA7", width=3)
    steps = [
        (290, "UPLOAD_INIT 文件名 大小 整体哈希", True),
        (410, "UPLOAD_READY 缺失分块列表", False),
        (540, "UPLOAD_CHUNK 协议头和载荷", True),
        (660, "校验哈希 持久写入", True),
        (780, "CHUNK_ACK", False),
        (900, "UPLOAD_COMPLETE", True),
        (1010, "整文件校验与原子提交", False),
    ]
    for y, label, to_server in steps:
        start, end = ((330, y), (1160, y)) if to_server else ((1160, y), (330, y))
        arrow(draw, start, end, width=4)
        bbox = draw.textbbox((0, 0), label, font=font(22))
        draw.rectangle((740 - bbox[2]/2 - 12, y - 34, 740 + bbox[2]/2 + 12, y + 5), fill="white")
        draw.text((740 - bbox[2]/2, y - 30), label, font=font(22), fill="#243A33")
    path = ASSET_DIR / "upload-sequence.png"; image.save(path, quality=95); return path


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd")) or OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    if shd.getparent() is None: tc_pr.append(shd)


def set_cell_margins(cell, top=110, start=130, bottom=110, end=130):
    tc = cell._tc; tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None: tc_mar = OxmlElement("w:tcMar"); tc_pr.append(tc_mar)
    for name, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{name}")) or OxmlElement(f"w:{name}")
        node.set(qn("w:w"), str(value)); node.set(qn("w:type"), "dxa")
        if node.getparent() is None: tc_mar.append(node)


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr(); node = OxmlElement("w:tblHeader"); node.set(qn("w:val"), "true"); tr_pr.append(node)


def style_table(table, widths=None):
    table.alignment = WD_TABLE_ALIGNMENT.CENTER; table.autofit = False
    for r_index, row in enumerate(table.rows):
        if r_index == 0: set_repeat_table_header(row)
        for c_index, cell in enumerate(row.cells):
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            set_cell_margins(cell)
            if widths: cell.width = Inches(widths[c_index])
            set_cell_shading(cell, NAVY if r_index == 0 else (PALE if r_index % 2 == 0 else "FFFFFF"))
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.space_after = Pt(0)
                paragraph.paragraph_format.line_spacing = 1.15
                for run in paragraph.runs:
                    run.font.name = "Microsoft YaHei"; run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
                    run.font.size = Pt(9.5); run.font.color.rgb = RGBColor(255,255,255) if r_index == 0 else TEXT
                    if r_index == 0: run.bold = True
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders") or OxmlElement("w:tblBorders")
    for edge in ("top","left","bottom","right","insideH","insideV"):
        tag = borders.find(qn(f"w:{edge}")) or OxmlElement(f"w:{edge}")
        tag.set(qn("w:val"), "single"); tag.set(qn("w:sz"), "5"); tag.set(qn("w:color"), GRAY)
        if tag.getparent() is None: borders.append(tag)
    if borders.getparent() is None: tbl_pr.append(borders)


def add_table(doc, headers, rows, widths):
    table = doc.add_table(rows=1, cols=len(headers))
    for i, value in enumerate(headers): table.rows[0].cells[i].text = value
    for row in rows:
        cells = table.add_row().cells
        for i, value in enumerate(row): cells[i].text = str(value)
    style_table(table, widths)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def set_run_font(run, name="Microsoft YaHei", size=10.5, bold=False, color=TEXT):
    run.font.name = name; run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size); run.bold = bold; run.font.color.rgb = color


def body(doc, text, bold_lead=None):
    p = doc.add_paragraph()
    p.paragraph_format.first_line_indent = Pt(21)
    p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.line_spacing = 1.45
    if bold_lead and text.startswith(bold_lead):
        lead = p.add_run(bold_lead); set_run_font(lead, bold=True)
        rest = p.add_run(text[len(bold_lead):]); set_run_font(rest)
    else:
        run = p.add_run(text); set_run_font(run)
    return p


def bullets(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.left_indent = Inches(0.28); p.paragraph_format.space_after = Pt(4); p.paragraph_format.line_spacing = 1.3
        set_run_font(p.add_run(item))


def code_block(doc, text):
    p = doc.add_paragraph(); p.paragraph_format.left_indent = Inches(0.25); p.paragraph_format.right_indent = Inches(0.25)
    p.paragraph_format.space_before = Pt(5); p.paragraph_format.space_after = Pt(8); p.paragraph_format.line_spacing = 1.15
    p_pr = p._p.get_or_add_pPr(); shd = OxmlElement("w:shd"); shd.set(qn("w:fill"), "F0F3F1"); p_pr.append(shd)
    for index, line in enumerate(text.splitlines()):
        run = p.add_run(line); set_run_font(run, "Consolas", 8.7, color=RGBColor(27, 54, 46))
        if index < len(text.splitlines()) - 1: run.add_break()


def add_heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    p.paragraph_format.keep_with_next = True
    return p


def add_figure(doc, path, caption, width=6.7):
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(str(path), width=Inches(width))
    c = doc.add_paragraph(caption); c.alignment = WD_ALIGN_PARAGRAPH.CENTER; c.paragraph_format.space_after = Pt(10); c.paragraph_format.keep_with_next = False
    set_run_font(c.add_run(""), size=9)


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run(); fld = OxmlElement("w:fldSimple"); fld.set(qn("w:instr"), "PAGE"); run._r.addnext(fld)


doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.5); section.page_height = Inches(11)
section.top_margin = Inches(0.72); section.bottom_margin = Inches(0.68); section.left_margin = Inches(0.78); section.right_margin = Inches(0.78)

styles = doc.styles
normal = styles["Normal"]; normal.font.name = "Microsoft YaHei"; normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei"); normal.font.size = Pt(10.5); normal.font.color.rgb = TEXT
title = styles["Title"]; title.font.name = "Microsoft YaHei"; title._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei"); title.font.size = Pt(28); title.font.bold = True; title.font.color.rgb = RGBColor(0,0,0)
title_ppr = title._element.get_or_add_pPr()
title_border = title_ppr.find(qn("w:pBdr"))
if title_border is not None: title_ppr.remove(title_border)
for name, size in (("Heading 1", 17), ("Heading 2", 13), ("Heading 3", 11)):
    style = styles[name]; style.font.name = "Microsoft YaHei"; style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei"); style.font.size = Pt(size); style.font.bold = True; style.font.color.rgb = RGBColor(0,0,0)
    style.paragraph_format.space_before = Pt(14 if name == "Heading 1" else 10); style.paragraph_format.space_after = Pt(7); style.paragraph_format.keep_with_next = True

footer = section.footer
fp = footer.paragraphs[0]; fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_run_font(fp.add_run("Sentinel Transfer 实验报告   "), size=8, color=RGBColor(100,110,106)); add_page_number(fp)

# Cover
p = doc.add_paragraph(); p.paragraph_format.space_before = Inches(1.35); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = p.add_run("软件与系统安全"); set_run_font(run, size=13, bold=True, color=RGBColor(46,86,72))
p = doc.add_paragraph(style="Title"); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_before = Pt(24); p.add_run("实验 1B 安全文件传输系统设计与实现")
direct_border = p._p.get_or_add_pPr().find(qn("w:pBdr"))
if direct_border is not None: p._p.get_or_add_pPr().remove(direct_border)
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_before = Pt(14)
set_run_font(p.add_run("Sentinel Transfer"), size=18, bold=True, color=RGBColor(15,106,77))
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_before = Inches(1.1)
set_run_font(p.add_run("基于 HTTPS WSS 与自定义分块协议的可恢复文件传输系统"), size=12)
meta = doc.add_table(rows=5, cols=2); meta.alignment = WD_TABLE_ALIGNMENT.CENTER
for i, (key, value) in enumerate((("姓名", "请填写"), ("学号", "请填写"), ("课程", "软件与系统安全"), ("代码仓库", "请填写 GitHub Gitee 或 GitLab 地址"), ("完成日期", "2026 年 11 月 10 日"))):
    meta.rows[i].cells[0].text = key; meta.rows[i].cells[1].text = value
style_table(meta, [1.35, 4.65])
doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

# Opening and contents
add_heading(doc, "报告说明", 1)
body(doc, "本报告说明 Sentinel Transfer 的需求分析、应用层协议、安全控制、鲁棒性机制、测试证据与部署方式。系统已经完成课程要求的多用户并发、完整文件传输、长连接和协议设计，并实现断点续传、公钥证书认证、多文件并发、下载恢复、账户配额和按用户带宽控制等加分功能。")
body(doc, "实现以数据安全和故障可恢复为首要约束。客户端只提交显示文件名，服务端使用随机标识保存内容；每个数据分块在写盘前校验 SHA-256，完成时再次计算整文件哈希；任何资源访问都同时匹配文件标识与用户标识。")
add_heading(doc, "目录", 1)
contents = ["1 实验目标与完成情况", "2 需求分析与实现映射", "3 系统架构", "4 应用层协议设计", "5 身份认证与会话安全", "6 文件存储与访问控制", "7 完整性与故障恢复", "8 并发与带宽控制", "9 攻击面与防护措施", "10 测试方法与结果", "11 部署与运行", "12 局限与改进方向", "13 实验结论"]
for item in contents:
    p = doc.add_paragraph(); p.paragraph_format.left_indent = Inches(0.2); p.paragraph_format.space_after = Pt(5); set_run_font(p.add_run(item), size=10.5)
doc.add_page_break()

add_heading(doc, "1 实验目标与完成情况", 1)
body(doc, "本实验实现一个可在 Windows 判卷环境中运行的安全文件传输系统。系统采用浏览器客户端和 Node.js 服务端，使用 HTTPS 提供账户与文件管理接口，使用 WSS 建立持续连接，并在该连接上运行自定义 SFT Protocol V1。连接由客户端主动关闭，传完一个文件后不会自动结束 TCP 会话。")
body(doc, "系统完成了上传、下载、文件列表、删除、用户隔离、并发任务、带宽策略和审计。传输协议显式描述文件大小、分块序号、字节偏移、载荷长度和 SHA-256，因此接收端不依赖关闭连接判断文件结束。")
add_table(doc, ["类别", "实现结果", "验证方式"], [
    ("基础功能", "多用户并发访问与完整文件传输", "双用户隔离测试和端到端哈希比对"),
    ("长连接", "HTTPS 登录后通过 WSS 维持应用连接", "服务端心跳与客户端显式关闭"),
    ("协议设计", "JSON 控制帧和长度前缀二进制帧", "协议编解码单元测试"),
    ("安全通信", "TLS 1.2 以上和可选双向证书认证", "OpenSSL 证书校验与握手测试"),
    ("断点续传", "服务端返回缺失分块列表", "中断后重新选择同一文件"),
    ("并行传输", "客户端最多三个文件并行", "多文件队列测试"),
    ("带宽控制", "管理员为用户设置字节每秒速率", "限速前后传输时间对比"),
], [1.15, 3.2, 2.65])

add_heading(doc, "2 需求分析与实现映射", 1)
body(doc, "课程要求关注协议设计、安全性和可演示性。表 2 将每一项要求对应到可检查的代码与运行行为，避免只在报告中声明功能而没有实现证据。")
add_table(doc, ["要求", "设计决定", "主要实现位置"], [
    ("多用户", "账户表使用唯一用户名，文件查询强制 user_id", "server/src/app.ts 和 storage.ts"),
    ("并发", "独立 WSS 会话和每上传会话串行写队列", "server/src/websocket.ts 和 storage.ts"),
    ("完整传输", "分块哈希与整文件哈希双层校验", "web/src/protocol.ts 和 storage.ts"),
    ("中间人防护", "HTTPS WSS 本地 CA 可选 mTLS", "server/src/app.ts 和 scripts/generate-certs.ps1"),
    ("DDoS 缓解", "多级登录退避 连接与消息上限 用户配额 磁盘余量 背压", "app.ts storage.ts docker-compose.yml"),
    ("SQL 注入防护", "所有 SQL 值使用占位参数", "server/src/db.ts auth.ts storage.ts"),
    ("长连接", "WSS 心跳和连接生命周期管理", "server/src/websocket.ts"),
    ("协议图", "帧格式和上传下载时序", "docs/PROTOCOL.md 与本报告第 4 节"),
], [1.35, 3.1, 2.55])

add_heading(doc, "3 系统架构", 1)
body(doc, "系统分为浏览器客户端、HTTPS API、WSS 协议处理、SQLite 元数据和隔离文件存储。API 负责低频控制操作；大块文件数据只在 WSS 二进制帧中传输。该划分使认证、传输和存储的责任清楚，同时让上传会话能跨 WebSocket 重连恢复。")
add_figure(doc, make_architecture(), "图 1 Sentinel Transfer 系统架构", 6.9)
add_heading(doc, "3 1 客户端", 2)
body(doc, "Vue 客户端将访问令牌只保存在内存中，刷新令牌由 HttpOnly Cookie 保存。文件上传前以 4 MiB 步长增量计算整文件 SHA-256，随后按 1 MiB 默认分块发送。用户一次选择多个文件时，任务队列最多并行执行三个任务。下载在支持 File System Access API 的浏览器中直接流式写盘，断线后从已写入偏移继续。")
add_heading(doc, "3 2 服务端", 2)
body(doc, "Fastify 服务端统一设置安全响应头、请求体上限、来源检查和速率限制。WebSocket 协议处理器消费一次性票据后建立连接，并使用心跳发现失活客户端。存储服务验证协议字段、执行持久写入、维护已接收分块记录，并在最终校验通过后原子提交文件。")
add_heading(doc, "3 3 数据层", 2)
body(doc, "SQLite 采用 WAL、外键、busy timeout 与 FULL 同步。数据库保存账户状态与配额、刷新令牌族、文件元数据、上传会话、已确认分块和审计事件。schema_migrations 记录事务迁移版本；审计表触发器拒绝 UPDATE 和 DELETE。文件内容不进入数据库，而是使用服务端生成的 UUID 文件名保存在数据目录中。")

add_heading(doc, "4 应用层协议设计", 1)
body(doc, "SFT Protocol V1 同时使用文本控制帧和二进制数据帧。每个请求包含协议版本与随机 requestId，响应使用同一编号关联。数据帧前四字节表示 JSON 协议头长度，接收端据此分离元数据和载荷。")
add_figure(doc, make_protocol_frame(), "图 2 SFT 二进制帧格式", 6.8)
add_table(doc, ["字段", "类型", "含义", "校验"], [
    ("v", "整数", "协议版本 固定为 1", "不匹配则拒绝"),
    ("type", "字符串", "消息类型", "白名单判别联合"),
    ("requestId", "字符串", "请求响应关联", "长度 8 至 80"),
    ("uploadId", "UUID", "上传会话标识", "必须属于当前用户"),
    ("index", "整数", "分块序号", "小于 totalChunks"),
    ("offset", "整数", "文件字节偏移", "必须等于 index 乘 chunkSize"),
    ("size", "整数", "本帧载荷大小", "与实际长度一致且不超过 4 MiB"),
    ("sha256", "64 位十六进制", "载荷或整文件摘要", "重新计算后精确匹配"),
], [1.05, 1.2, 2.25, 2.5])
add_heading(doc, "4 1 消息类型", 2)
add_table(doc, ["客户端消息", "服务端响应", "作用"], [
    ("UPLOAD_INIT", "UPLOAD_READY", "创建或恢复会话并返回缺失分块"),
    ("UPLOAD_CHUNK", "CHUNK_ACK", "校验并持久化一个分块"),
    ("UPLOAD_COMPLETE", "UPLOAD_DONE", "验证整文件并原子提交"),
    ("DOWNLOAD_INIT", "DOWNLOAD_META", "验证所有权并声明下载参数"),
    ("无", "DOWNLOAD_CHUNK", "顺序发送带哈希的数据分块"),
    ("无", "DOWNLOAD_DONE", "声明文件传输结束与整体哈希"),
    ("任意非法消息", "ERROR", "返回稳定错误码且隐藏内部路径"),
], [1.75, 1.75, 3.5])
add_heading(doc, "4 2 上传时序", 2)
add_figure(doc, make_sequence(), "图 3 可恢复上传时序", 6.5)
body(doc, "客户端先发送 UPLOAD_INIT。服务端按当前用户、显示文件名、大小和整文件哈希查找未完成上传，并返回 missingChunks。每个 UPLOAD_CHUNK 只有在哈希、序号、偏移和长度全部正确时才写入临时文件；fsync 完成后数据库才记录该分块并返回 CHUNK_ACK。")
body(doc, "客户端发送 UPLOAD_COMPLETE 后，服务端确认分块数量、文件长度和整文件 SHA-256。通过后使用 rename 将临时文件原子移动到正式存储名，并在事务中写入文件元数据和删除上传会话。校验失败时不会暴露半成品文件。")
add_heading(doc, "4 3 下载时序", 2)
body(doc, "客户端下载通过 DOWNLOAD_INIT 指定 fileId、chunkSize 和 offset。服务端先检查 fileId 与当前 user_id 的所有权，再从 offset 开始顺序读取。每个 DOWNLOAD_CHUNK 都携带偏移、长度和分块哈希；DOWNLOAD_DONE 携带整文件哈希。客户端逐块校验并流式写入本地文件，连接中断时最多自动恢复三次；不支持流式写盘的旧浏览器对超过 256 MiB 的下载主动拒绝，避免 Blob 占满内存。")

add_heading(doc, "5 身份认证与会话安全", 1)
add_heading(doc, "5 1 密码存储", 2)
body(doc, "密码在服务端使用 scrypt 派生 32 字节密钥。每个密码使用 16 字节随机盐，参数为 N=32768、r=8、p=1，并限制最大内存。验证时使用 timingSafeEqual。注册接口要求密码不少于 12 位，并同时包含大小写字母、数字和特殊字符。")
add_heading(doc, "5 2 注册与账户生命周期", 2)
body(doc, "用户名先执行 trim、NFKC 规范化和小写折叠，再由数据库不区分大小写的唯一约束处理并发重复注册。公开注册固定创建普通用户，系统保留名称被拒绝；管理员只能通过服务器本机交互脚本创建，该脚本拒绝提升已有账户。管理员可禁用账户并配置配额，用户可修改密码或撤销全部设备会话。上述操作会立即撤销刷新令牌，访问令牌每次使用时回查账户状态和密码版本，因此无需等待 15 分钟到期。")
add_heading(doc, "5 3 令牌机制", 2)
body(doc, "访问令牌使用 HS256 签名，包含 issuer、audience、subject、密码版本、签发时间和 15 分钟有效期。刷新令牌为 48 字节随机值，浏览器只通过 HttpOnly、Secure、SameSite Strict Cookie 持有；数据库只存其 SHA-256。每次刷新把旧令牌标记为已使用并创建同族替代令牌。若已使用令牌再次出现，服务端将其判为重放并撤销整个令牌族。")
add_heading(doc, "5 4 WebSocket 票据", 2)
body(doc, "浏览器无法在原生 WebSocket 构造函数中添加 Authorization 请求头，因此客户端先使用访问令牌申请 30 秒有效的一次性票据。服务端只在内存中保存票据哈希，升级连接时立即消费。票据不会进入长期存储，日志序列化也不记录查询参数。")
add_heading(doc, "5 5 TLS 与双向证书", 2)
body(doc, "服务端直接加载证书和私钥，并将最低 TLS 版本设为 1.2。证书脚本生成本地 CA、包含 localhost 与 127.0.0.1 SAN 的服务端证书，以及带 clientAuth 扩展的客户端证书。启用 MTLS_ENABLED 后，服务端请求并验证客户端证书。")

add_heading(doc, "6 文件存储与访问控制", 1)
body(doc, "显示文件名只作为元数据保存。safeDisplayName 先做 NFC 规范化，再拒绝斜杠、反斜杠、控制字符、单点和双点名称。磁盘上的临时文件和正式文件名均由服务端 UUID 生成，因此用户输入无法参与路径拼接。")
body(doc, "服务端没有按 fileId 单独查询后再在应用层比较用户，而是在 SQL 查询中同时使用 fileId 与 user_id。上传会话也按 uploadId 与 user_id 查询。即使攻击者获得另一个用户的随机标识，查询仍返回不存在或无权访问。")
body(doc, "UPLOAD_INIT 在 IMMEDIATE 事务中同时检查已完成文件、活动上传预留、用户配额和活动会话数；事务提交前还检查文件系统可用空间并保留安全余量。配额通过后才创建临时文件。同一用户重复上传同名文件时，服务端在事务中分配递增 version，旧版本不会被覆盖。")
add_table(doc, ["操作", "持久化顺序", "失败处理"], [
    ("写入分块", "校验 位置写入 fsync 数据库记录", "写盘失败不记录 ACK"),
    ("完成上传", "全文件校验 rename 数据库事务", "事务失败尝试移回临时文件"),
    ("删除文件", "rename 到临时删除名 删除元数据 unlink", "元数据失败时恢复原名"),
    ("清理上传", "查找 48 小时未更新会话 删除记录 删除临时文件", "下次定时任务继续清理"),
], [1.15, 3.45, 2.55])

add_heading(doc, "7 完整性与故障恢复", 1)
add_heading(doc, "7 1 两级完整性验证", 2)
body(doc, "客户端为每个分块计算 SHA-256，服务端在落盘前重新计算。分块记录保存对应哈希，若同一分块被重传但哈希或长度不同，服务端拒绝覆盖。所有分块完成后，服务端以流式读取方式重新计算整文件哈希；下载端也重复执行分块和整文件验证。")
add_heading(doc, "7 2 崩溃一致性", 2)
body(doc, "分块处理遵循先写文件、fsync、后写数据库的顺序。若进程在写盘后、数据库提交前崩溃，该分块会在恢复时被视为缺失并安全覆盖相同位置；不会出现数据库声明已接收但磁盘数据尚未持久化的情况。SQLite FULL 同步进一步降低断电后事务丢失风险。")
add_heading(doc, "7 3 重连与幂等", 2)
body(doc, "客户端上传失败后最多自动重连三次。每次重连重新申请一次性票据并发送相同的文件身份信息。服务端返回缺失序号，客户端只发送缺失分块。已确认分块的完全相同重传被视为幂等操作，不会重复计数。")
body(doc, "下载也最多自动重连三次。客户端保留增量 SHA-256 状态和已写入字节数，新连接以该字节数作为 offset 重新发送 DOWNLOAD_INIT。最终只有整文件哈希匹配时才关闭本地写入流并报告成功。")

add_heading(doc, "8 并发与带宽控制", 1)
body(doc, "不同上传会话可以并行执行；同一 uploadId 的任务通过 Promise 队列串行化，避免两个消息同时写入同一临时文件。服务端限制每用户最多五条 WSS 连接，客户端默认最多三个并行文件任务。WebSocket 最大消息限制略高于 4 MiB 数据上限。")
body(doc, "下载发送前检查 bufferedAmount，超过 8 MiB 时暂停，避免慢客户端导致无限内存增长。上传采用逐块 ACK，客户端收到确认后才继续，因此服务端能够自然施加背压。每个连接使用令牌桶限制上传和下载字节率；管理员可为用户设置独立 bandwidth_bps。存储层另行限制每用户活动上传会话数、总配额和磁盘安全余量。")

add_heading(doc, "9 攻击面与防护措施", 1)
add_table(doc, ["攻击或故障", "防护措施", "边界"], [
    ("中间人", "TLS 1.2+ 证书校验 可选 mTLS HSTS", "错误信任恶意根证书无法由应用纠正"),
    ("暴力登录", "scrypt 强密码 IP 用户名/IP 账户三级计数 指数退避", "分布式低频来源需要边缘设施"),
    ("管理员抢注", "公开注册固定为 user 管理员本机初始化", "主机权限超出应用边界"),
    ("会话重放", "刷新令牌族轮换 重放撤销全族 状态实时回查", "终端被控仍需处置"),
    ("SQL 注入", "所有值使用预编译参数", "依赖漏洞通过审计与升级管理"),
    ("路径穿越", "文件名白名单式校验 磁盘 UUID", "主机管理员已超出应用信任边界"),
    ("水平越权", "资源标识与 user_id 联合查询", "数据库管理员权限需另行保护"),
    ("恶意大包", "消息 文件 请求体和连接上限", "大规模流量需防火墙或反向代理"),
    ("内容篡改", "分块与整文件 SHA-256", "不替代异地备份"),
    ("XSS 点击劫持", "Vue 转义 CSP frame-ancestors none", "新增富文本功能需重新审计"),
], [1.25, 3.6, 2.3])
body(doc, "DDoS 无法仅靠单个应用进程彻底解决。本实现针对连接、消息、请求频率、带宽、CPU 和内存设置边界；Docker 部署还使用非 root 用户、只读根文件系统、cap_drop ALL、no-new-privileges 和资源限制。面向公网时仍应在应用前部署防火墙或具备连接清洗能力的反向代理。")

add_heading(doc, "10 测试方法与结果", 1)
add_heading(doc, "10 1 自动化测试", 2)
body(doc, "2026 年 11 月 10 日在 Windows 和 Node.js 20.18.0 环境完成严格 TypeScript 构建与自动化测试。服务端 14 项测试覆盖协议编解码、旧数据库迁移、重复注册竞态、令牌重放、账户禁用、改密撤销、配额预留、上传会话上限、文件版本和追加式审计；客户端 3 项测试覆盖二进制帧、异常帧和增量文件哈希。")
code_block(doc, "npm run build\nnpm test\nnpm audit --omit=dev")
add_table(doc, ["检查", "结果", "判定"], [
    ("前后端生产构建", "TypeScript 与 Vite 构建完成", "通过"),
    ("服务端自动化测试", "4 个测试文件 14 项测试", "全部通过"),
    ("客户端自动化测试", "1 个测试文件 3 项测试", "全部通过"),
    ("生产依赖审计", "0 个已知漏洞", "通过"),
    ("证书验证", "server.crt 和 client.crt 均为 OK", "通过"),
], [2.0, 3.2, 1.6])
add_heading(doc, "10 2 端到端传输", 2)
body(doc, "端到端脚本通过真实 HTTPS 注册账户，申请一次性 WSS 票据，上传 2,109,497 字节随机文件。文件被分为三个数据块，服务端逐块持久化并完成整文件校验；脚本随后建立新的 WSS 连接下载文件，逐块比对并验证最终 SHA-256，最后通过授权 API 删除测试文件。")
code_block(doc, "npm run test:e2e\nE2E PASS: 2109497 bytes, 3 chunks, SHA-256 已验证")
add_heading(doc, "10 3 安全与稳定性测试计划", 2)
body(doc, "docs/TEST_PLAN.md 给出重复注册、令牌族重放、账户撤销、配额、版本化、双用户隔离、边界大小、断点恢复、多文件并发、路径穿越、错误哈希、越权、跨来源、超大消息和 mTLS 的复现实验步骤。正式录屏时应逐项展示关键结果，并保留终端输出。")

add_heading(doc, "11 部署与运行", 1)
add_heading(doc, "11 1 Windows 本地运行", 2)
body(doc, "Windows 启动脚本检查依赖、生成本地 CA 与服务端和客户端证书、创建 48 字节随机 JWT 密钥、执行生产构建并启动 HTTPS 服务。")
code_block(doc, "Set-ExecutionPolicy -Scope Process Bypass\n.\\scripts\\start-dev.ps1\n# 浏览器访问 https://localhost:8443")
body(doc, "公开注册永远只能创建普通用户。初始管理员必须在服务器本机另开 PowerShell 执行下列命令；密码通过 SecureString 读取并仅经子进程环境传递，不进入命令历史。")
code_block(doc, ".\\scripts\\create-admin.ps1 -Username admin")
add_heading(doc, "11 2 Docker 部署", 2)
body(doc, "Docker 采用两阶段构建。运行阶段只复制生产依赖、服务端编译产物和前端静态资源，并使用 UID 10001 的非 root 用户。compose 文件将证书和 JWT 密钥只读挂载，数据目录单独持久化，根文件系统设为只读。")
code_block(doc, "npm run certs\n.\\scripts\\create-docker-secret.ps1\ndocker compose up --build")
body(doc, "正式环境必须替换演示 CA 和客户端证书密码，设置真实 PUBLIC_ORIGIN，将 CA 私钥移出服务主机，并建立数据库和文件目录的同步备份。")

add_heading(doc, "12 局限与改进方向", 1)
body(doc, "流式下载依赖 Chromium 的 File System Access API。旧浏览器只能回退为内存 Blob，因此客户端对超过 256 MiB 的回退下载主动拒绝。若需覆盖所有浏览器并保持大文件续传，可增加原生桌面客户端或采用浏览器可持久化的分块缓存方案。")
body(doc, "SQLite WAL 能稳定支持本实验规模的并发，但多实例部署需要共享数据库和分布式一次性票据存储。面向大规模生产场景可迁移到 PostgreSQL，将票据放入 Redis，并将文件内容放入支持版本和校验的对象存储。")
body(doc, "应用层限频、配额和磁盘余量只能缓解资源耗尽。真正的大规模分布式 DDoS 需要在网络边缘进行连接限制与流量清洗。审计表已由触发器禁止更新和删除，但仍与业务数据库共存；高安全部署应将日志异步发送到独立的只追加远程存储。")

add_heading(doc, "13 实验结论", 1)
body(doc, "Sentinel Transfer 完成了安全文件传输实验的基础要求和主要加分项。系统以 WSS 长连接运行自定义协议，明确描述文件边界和控制信息，并通过逐块确认、断点恢复、两级 SHA-256、原子提交与用户所有权查询保证传输正确性。")
body(doc, "安全设计覆盖 TLS 与可选 mTLS、scrypt 密码存储、本机管理员初始化、短期访问令牌、令牌族重放检测、实时账户撤销、一次性 WSS 票据、版本化数据库迁移、参数化 SQL、用户配额、磁盘余量、路径隔离、背压、带宽策略和容器最小权限。17 项自动化测试、生产依赖审计和真实端到端传输均已通过，工程能够在 Windows 环境中直接构建、运行和演示。")

add_heading(doc, "附录 关键文件", 1)
add_table(doc, ["文件", "用途"], [
    ("server/src/websocket.ts", "长连接生命周期 消息分派 下载流和背压"),
    ("server/src/storage.ts", "分块验证 随机访问写入 整体校验 原子提交"),
    ("server/src/auth.ts", "访问令牌 实时撤销 令牌族轮换 一次性票据"),
    ("web/src/protocol.ts", "客户端协议编解码 上传和流式下载恢复"),
    ("scripts/create-admin.ps1", "本机安全初始化管理员"),
    ("scripts/generate-certs.ps1", "CA 服务端和客户端证书生成与验证"),
    ("docker-compose.yml", "非 root 只读根文件系统和资源限制"),
    ("docs/TEST_PLAN.md", "功能 安全与稳定性测试步骤"),
], [2.7, 4.3])

doc.core_properties.title = "实验 1B 安全文件传输系统设计与实现"
doc.core_properties.subject = "软件与系统安全实验报告"
doc.core_properties.author = "请填写姓名"
doc.core_properties.keywords = "安全文件传输 WSS 断点续传 SHA-256 TLS"
doc.save(OUTPUT)
print(OUTPUT)

