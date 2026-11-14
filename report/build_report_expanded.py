from pathlib import Path
from datetime import date
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "report"
ASSETS = REPORT / "assets"
OUTPUT = REPORT / "实验1B安全文件传输系统实验报告_完整版.docx"
ASSETS.mkdir(parents=True, exist_ok=True)

BLACK = RGBColor(0, 0, 0)
TEXT = RGBColor(30, 39, 36)
MUTED = RGBColor(88, 103, 97)
GREEN = "0F5F46"
DARK = "173A30"
PALE = "EDF5F1"
LIGHT = "F5F7F6"
BORDER = "D9E1DD"
RED = RGBColor(185, 44, 44)


def set_font(run, size=10.2, bold=False, color=TEXT, name="Microsoft YaHei"):
    run.font.name = name
    rpr = run._element.get_or_add_rPr()
    rpr.rFonts.set(qn("w:ascii"), name)
    rpr.rFonts.set(qn("w:hAnsi"), name)
    rpr.rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.bold = bold
    run.font.color.rgb = color


def shade(cell, fill):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = tcpr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tcpr.append(shd)
    shd.set(qn("w:fill"), fill)


def cell_margin(cell, top=100, start=120, bottom=100, end=120):
    tcpr = cell._tc.get_or_add_tcPr()
    mar = tcpr.first_child_found_in("w:tcMar")
    if mar is None:
        mar = OxmlElement("w:tcMar")
        tcpr.append(mar)
    for key, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = mar.find(qn(f"w:{key}"))
        if node is None:
            node = OxmlElement(f"w:{key}")
            mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def repeat_header(row):
    trpr = row._tr.get_or_add_trPr()
    node = OxmlElement("w:tblHeader")
    node.set(qn("w:val"), "true")
    trpr.append(node)


def style_table(table, widths):
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    for ri, row in enumerate(table.rows):
        if ri == 0:
            repeat_header(row)
        for ci, cell in enumerate(row.cells):
            cell.width = Inches(widths[ci])
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            cell_margin(cell)
            shade(cell, DARK if ri == 0 else (PALE if ri % 2 == 0 else "FFFFFF"))
            for p in cell.paragraphs:
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.12
                for run in p.runs:
                    set_font(run, 8.7, ri == 0, RGBColor(255, 255, 255) if ri == 0 else TEXT)
    tblpr = table._tbl.tblPr
    borders = tblpr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tblpr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = borders.find(qn(f"w:{edge}"))
        if tag is None:
            tag = OxmlElement(f"w:{edge}")
            borders.append(tag)
        tag.set(qn("w:val"), "single")
        tag.set(qn("w:sz"), "5")
        tag.set(qn("w:color"), BORDER)


def table(doc, headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers))
    for i, value in enumerate(headers):
        t.rows[0].cells[i].text = str(value)
    for row in rows:
        cells = t.add_row().cells
        for i, value in enumerate(row):
            cells[i].text = str(value)
    style_table(t, widths)
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(2)
    return t


def heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    p.paragraph_format.keep_with_next = True
    return p


def paragraph(doc, text, lead=None):
    p = doc.add_paragraph()
    p.paragraph_format.first_line_indent = Pt(20)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.38
    if lead and text.startswith(lead):
        set_font(p.add_run(lead), bold=True)
        set_font(p.add_run(text[len(lead):]))
    else:
        set_font(p.add_run(text))
    return p


def bullet_list(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.left_indent = Inches(0.28)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.25
        set_font(p.add_run(item), 9.8)


def numbered_list(doc, items):
    for item in items:
        p = doc.add_paragraph(style="List Number")
        p.paragraph_format.left_indent = Inches(0.28)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.25
        set_font(p.add_run(item), 9.8)


def code(doc, text, title=None):
    if title:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(4)
        p.paragraph_format.space_after = Pt(2)
        set_font(p.add_run(title), 9, True, MUTED)
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.22)
    p.paragraph_format.right_indent = Inches(0.22)
    p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.line_spacing = 1.06
    ppr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), "F0F3F2")
    ppr.append(shd)
    lines = text.strip("\n").splitlines()
    for i, line in enumerate(lines):
        set_font(p.add_run(line), 7.8, False, RGBColor(32, 56, 48), "Consolas")
        if i != len(lines) - 1:
            p.add_run().add_break()
    return p


def figure(doc, path, caption, width=6.75):
    path = Path(path)
    if not path.exists():
        return
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(str(path), width=Inches(width))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_after = Pt(8)
    set_font(cap.add_run(caption), 8.7, False, MUTED)


def page_break(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def add_page_number(paragraph_obj):
    paragraph_obj.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph_obj.add_run()
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    run._r.addnext(fld)


def pil_font(size, bold=False):
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    ]
    for item in candidates:
        if item.exists():
            return ImageFont.truetype(str(item), size=size)
    return ImageFont.load_default()


def make_db_diagram():
    path = ASSETS / "database-schema.png"
    image = Image.new("RGB", (1800, 1050), "white")
    draw = ImageDraw.Draw(image)
    draw.text((60, 35), "SQLite 核心数据关系", font=pil_font(42, True), fill="#17231F")
    boxes = {
        "users": (690, 120, 1110, 350, ["id PK", "username UNIQUE NOCASE", "password_hash", "role status quota", "password_changed_at"]),
        "refresh_tokens": (70, 470, 500, 730, ["token_hash PK", "user_id FK", "family_id", "used_at revoked_at", "expires_at"]),
        "files": (660, 470, 1080, 730, ["id PK", "user_id FK", "display_name version", "storage_name UNIQUE", "size sha256"]),
        "uploads": (1270, 430, 1720, 735, ["id PK", "user_id FK", "display_name temp_name", "size sha256 chunk_size", "total_chunks updated_at"]),
        "upload_chunks": (1260, 825, 1730, 1010, ["upload_id FK", "chunk_index", "chunk_sha256 size", "PK upload_id chunk_index"]),
        "auth_attempts": (60, 825, 510, 1010, ["username ip PK", "failed_count", "locked_until", "last_failed_at"]),
        "audit_log": (660, 825, 1080, 1010, ["id PK", "user_id event detail", "ip created_at", "UPDATE DELETE 被触发器拒绝"]),
    }
    for name, (x1, y1, x2, y2, fields) in boxes.items():
        draw.rounded_rectangle((x1, y1, x2, y2), radius=18, fill="#F1F6F4", outline="#174D3C", width=4)
        draw.rectangle((x1, y1, x2, y1 + 58), fill="#173A30")
        draw.text((x1 + 18, y1 + 10), name, font=pil_font(28, True), fill="white")
        y = y1 + 76
        for field in fields:
            draw.text((x1 + 20, y), field, font=pil_font(22), fill="#24362F")
            y += 36
    def arrow(a, b, label):
        draw.line((a, b), fill="#3C7562", width=5)
        draw.ellipse((b[0]-7, b[1]-7, b[0]+7, b[1]+7), fill="#3C7562")
        mx, my = (a[0]+b[0])//2, (a[1]+b[1])//2
        draw.text((mx+8, my-30), label, font=pil_font(19), fill="#36584C")
    arrow((780, 350), (360, 470), "1 对多")
    arrow((900, 350), (860, 470), "1 对多")
    arrow((1040, 350), (1460, 430), "1 对多")
    arrow((1490, 735), (1490, 825), "1 对多")
    arrow((810, 350), (820, 825), "可选关联")
    image.save(path)
    return path


def make_auth_flow():
    path = ASSETS / "auth-flow.png"
    image = Image.new("RGB", (1700, 760), "white")
    draw = ImageDraw.Draw(image)
    draw.text((55, 35), "身份认证与传输授权链路", font=pil_font(40, True), fill="#17231F")
    steps = [
        (80, "登录", "scrypt 校验\n三级失败退避"),
        (410, "会话", "15 分钟 JWT\n7 天轮换刷新令牌"),
        (760, "票据", "30 秒有效\n一次消费"),
        (1090, "WSS", "协议 V1\n心跳和连接上限"),
        (1420, "存储", "user_id 联合查询\nUUID 磁盘名"),
    ]
    for x, title, detail in steps:
        draw.rounded_rectangle((x, 190, x + 250, 560), radius=24, fill="#EFF6F2", outline="#174D3C", width=4)
        draw.rectangle((x, 190, x + 250, 260), fill="#173A30")
        draw.text((x + 82, 205), title, font=pil_font(30, True), fill="white")
        for i, line in enumerate(detail.split("\n")):
            draw.text((x + 24, 320 + i * 70), line, font=pil_font(24), fill="#24362F")
    for x in (330, 680, 1010, 1340):
        draw.line((x, 375, x + 80, 375), fill="#3C7562", width=8)
        draw.polygon([(x+80, 375), (x+55, 360), (x+55, 390)], fill="#3C7562")
    draw.text((510, 650), "密码修改  禁用账户  角色变化  撤销全部会话", font=pil_font(26, True), fill="#9B2F2F")
    draw.line((470, 630, 1280, 630), fill="#B44A4A", width=5)
    image.save(path)
    return path


def setup_document():
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Inches(8.27)
    sec.page_height = Inches(11.69)
    sec.top_margin = Inches(0.68)
    sec.bottom_margin = Inches(0.65)
    sec.left_margin = Inches(0.72)
    sec.right_margin = Inches(0.72)
    normal = doc.styles["Normal"]
    normal.font.name = "Microsoft YaHei"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.font.size = Pt(10.2)
    normal.font.color.rgb = TEXT
    title = doc.styles["Title"]
    title.font.name = "Microsoft YaHei"
    title._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    title.font.size = Pt(27)
    title.font.bold = True
    title.font.color.rgb = BLACK
    title_ppr = title._element.get_or_add_pPr()
    title_border = title_ppr.find(qn("w:pBdr"))
    if title_border is not None:
        title_ppr.remove(title_border)
    for name, size, before in (("Heading 1", 16.5, 15), ("Heading 2", 12.7, 10), ("Heading 3", 10.8, 8)):
        s = doc.styles[name]
        s.font.name = "Microsoft YaHei"
        s._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        s.font.size = Pt(size)
        s.font.bold = True
        s.font.color.rgb = BLACK
        s.paragraph_format.space_before = Pt(before)
        s.paragraph_format.space_after = Pt(6)
        s.paragraph_format.keep_with_next = True
    footer = sec.footer.paragraphs[0]
    set_font(footer.add_run("Sentinel Transfer 实验 1B 实验报告   "), 8, False, MUTED)
    add_page_number(footer)
    return doc


doc = setup_document()

# Cover
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Inches(1.25)
set_font(p.add_run("软件与系统安全"), 14, True, RGBColor(39, 78, 65))
p = doc.add_paragraph(style="Title")
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(24)
p.add_run("实验 1B 安全文件传输系统设计与实现")
direct_border = p._p.get_or_add_pPr().find(qn("w:pBdr"))
if direct_border is not None:
    p._p.get_or_add_pPr().remove(direct_border)
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(12)
set_font(p.add_run("Sentinel Transfer"), 18, True, RGBColor(15, 95, 70))
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(14)
set_font(p.add_run("基于 HTTPS WSS 与自定义分块协议的安全可恢复文件传输系统"), 11.5)
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Inches(0.9)
set_font(p.add_run("实现级实验报告"), 13, True, MUTED)
meta = doc.add_table(rows=5, cols=2)
for i, (k, v) in enumerate((
    ("姓名", "请填写"), ("学号", "请填写"), ("课程", "软件与系统安全"),
    ("代码仓库", "请填写 GitHub Gitee 或 GitLab 地址"), ("完成日期", "2026 年 11 月 14 日"),
)):
    meta.rows[i].cells[0].text = k
    meta.rows[i].cells[1].text = v
style_table(meta, [1.35, 4.7])
for row in meta.rows:
    if "请填写" in row.cells[1].text:
        for run in row.cells[1].paragraphs[0].runs:
            set_font(run, 9, True, RED)
page_break(doc)

heading(doc, "报告说明", 1)
paragraph(doc, "本报告从课程要求、设计依据、具体实现和验证证据四个层面说明 Sentinel Transfer。内容以当前源码为准，覆盖注册、登录、账户生命周期、管理员安全、数据库、传输协议、上传下载、断点恢复、并发限速、攻击面、部署和测试。报告不把功能名称当作实现证据，而是给出关键执行路径、约束条件、主要代码位置和实际测试结果。")
paragraph(doc, "系统的核心目标是保证文件在不可信网络和异常中断条件下仍能被正确认证、完整传输、可靠落盘并按用户隔离。安全设计同时考虑误操作、并发竞争、重复请求、磁盘空间不足、账户被禁用、令牌重放和服务进程崩溃等情况。")
heading(doc, "目录", 1)
contents = [
    "1 实验目标与完成情况", "2 课程要求与实现映射", "3 技术选型与总体架构", "4 数据库设计与迁移",
    "5 注册登录与密码存储", "6 会话令牌与 WebSocket 认证", "7 管理员角色与账户生命周期", "8 自定义文件传输协议",
    "9 安全上传实现", "10 下载断点恢复与完整性", "11 存储隔离访问控制与配额", "12 并发限速与资源安全",
    "13 数据一致性故障恢复与审计", "14 攻击面与安全防护", "15 部署运行与操作说明", "16 测试证据局限与结论",
]
for item in contents:
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.2)
    p.paragraph_format.space_after = Pt(4)
    set_font(p.add_run(item), 10)
page_break(doc)

# 1
heading(doc, "1 实验目标与完成情况", 1)
paragraph(doc, "本实验实现一个可在 Windows 环境独立构建和运行的多用户安全文件传输系统。浏览器通过 HTTPS 完成账户和管理操作，通过持久 WSS 连接运行自定义 SFT Protocol V1。系统支持完整文件传输、同名版本、分块确认、双层哈希、断点续传、多文件并发、账户配额、按用户限速、可选双向证书认证和安全审计。")
table(doc, ["能力", "实现结果", "可验证证据"], [
    ("多用户与隔离", "用户名唯一、文件与 user_id 联合授权", "双用户列表与越权测试"),
    ("长连接与协议", "WSS 持久连接、协议版本和请求编号", "协议编解码测试及协议图"),
    ("完整传输", "1 MiB 分块、逐块 ACK、整文件 SHA-256", "18 项自动化测试与端到端脚本"),
    ("断点续传", "上传缺失分块恢复、下载偏移恢复", "断网恢复测试计划"),
    ("安全通信", "TLS 1.2 以上、HSTS、可选 mTLS", "证书生成脚本与握手测试"),
    ("资源安全", "连接、消息、文件、配额、磁盘和带宽边界", "配置项、拒绝路径和存储测试"),
    ("账户安全", "scrypt、令牌轮换、重放检测、实时撤销", "认证测试和账户安全页面"),
    ("管理员治理", "本机创建、角色显式变更、最后管理员保护", "角色测试和管理页面"),
], [1.45, 3.25, 2.25])
paragraph(doc, "基础要求均已落到可执行代码。加分功能不是独立装饰，而是与一致性和安全控制结合，例如断点续传依赖服务端持久化分块状态，管理员改角色会撤销目标账户会话，上传配额在创建临时文件之前原子预留。")

# 2
heading(doc, "2 课程要求与实现映射", 1)
paragraph(doc, "课程讲义要求实验 1B 支持多用户并发和完整文件传输，并考虑中间人攻击、DDoS 与 SQL 注入。下表将要求映射到当前实现，便于教师从报告、代码和演示视频三条路径复核。")
table(doc, ["要求或加分点", "具体实现", "主要文件"], [
    ("多用户", "注册登录、角色状态、所有权联合查询", "server/src/app.ts db.ts storage.ts"),
    ("并发", "独立 WSS、每上传串行队列、客户端三任务", "websocket.ts web/src/App.vue"),
    ("完整文件传输", "分块和整文件 SHA-256、长度偏移验证", "protocol.ts storage.ts"),
    ("中间人防护", "HTTPS WSS TLS 1.2+ 本地 CA 可选 mTLS", "app.ts generate-certs.ps1"),
    ("DDoS 缓解", "限频、消息上限、连接上限、配额、背压", "app.ts websocket.ts limiter.ts"),
    ("SQL 注入防护", "所有值使用预编译参数，标识符不接受输入", "db.ts auth.ts storage.ts"),
    ("断点续传", "missingChunks 和 download offset", "web/src/protocol.ts storage.ts"),
    ("带宽控制", "用户级字节每秒速率和串行令牌桶", "limiter.ts websocket.ts"),
    ("公钥证书", "CA 服务端证书客户端证书和 EKU", "generate-certs.ps1"),
], [1.55, 3.45, 2.0])

# 3
heading(doc, "3 技术选型与总体架构", 1)
paragraph(doc, "服务端选择 Node.js 20、TypeScript、Fastify 和 ws 生态，原因是异步流和 WebSocket 支持成熟，类型系统能约束协议字段，且 Windows 判卷环境容易复现。客户端使用 Vue 3 和 Web Crypto，界面状态与传输任务分离。SQLite 保存强一致元数据，文件内容独立保存在磁盘，避免大文件进入数据库。")
figure(doc, ASSETS / "architecture.png", "图 1 系统总体架构", 6.65)
table(doc, ["组件", "职责", "选择依据"], [
    ("Vue 客户端", "账户界面、任务队列、客户端哈希、流式写盘", "浏览器直接演示，默认文本转义降低 XSS 风险"),
    ("Fastify API", "认证、用户管理、文件列表和票据", "Schema 校验、插件化安全头和限频"),
    ("WSS 协议层", "二进制文件帧、心跳、背压和限速", "长连接可承载自定义协议并支持重连"),
    ("SQLite", "账户、令牌族、上传状态、文件元数据和审计", "事务、唯一约束、WAL，适合单机实验"),
    ("隔离文件目录", "临时文件和完成文件内容", "顺序及随机访问、高效处理大文件"),
], [1.35, 3.2, 2.45])
paragraph(doc, "API 与传输通道分离是一个有意的安全边界。访问令牌只用于短请求和申请一次性 WSS 票据，文件数据只进入受消息上限、限速和协议校验约束的 WSS 处理器。上传状态保存在数据库，因此断开某条连接不会丢失已确认进度。")

# 4
heading(doc, "4 数据库设计与迁移", 1)
paragraph(doc, "数据库不是可选装饰。本系统需要保存唯一账户、账户状态、角色、刷新令牌族、文件所有权、上传进度、分块确认和审计记录；这些数据必须在服务重启后仍然存在，并依赖事务处理并发竞争。SQLite 创建时启用 WAL、外键、5 秒 busy timeout 和 synchronous FULL。")
figure(doc, make_db_diagram(), "图 2 SQLite 核心数据关系", 6.75)
table(doc, ["数据表", "关键约束", "安全作用"], [
    ("users", "username UNIQUE COLLATE NOCASE；role status CHECK", "阻止重复账户并保存实时授权状态"),
    ("refresh_tokens", "token_hash 主键；family_id 索引", "数据库不存明文令牌，支持族级重放处置"),
    ("files", "storage_name UNIQUE；sha256 长度约束", "保存所有权、版本和完整性摘要"),
    ("uploads", "用户 文件名 大小 哈希联合唯一", "重连时定位同一未完成会话"),
    ("upload_chunks", "upload_id 与 chunk_index 联合主键", "防止同一分块重复计数"),
    ("auth_attempts", "username 与 ip 联合主键", "记录组合维度登录失败和退避"),
    ("audit_log", "UPDATE DELETE 触发器拒绝", "应用路径只能追加审计事件"),
    ("schema_migrations", "version 主键", "事务化、可重复升级旧数据库"),
], [1.45, 2.9, 2.65])
code(doc, """db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = FULL');

db.transaction(() => {
  db.exec(migration.sql);
  db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)')
    .run(migration.version, new Date().toISOString());
}).immediate();""", "关键实现 事务迁移与持久化策略 server/src/db.ts")
paragraph(doc, "迁移采用版本号而不是启动时重复执行 ALTER。旧版数据库没有 schema_migrations 记录时，程序先识别已有 users 表并补记版本 1，再在 IMMEDIATE 事务中升级版本 2。任何 SQL 失败都会回滚整次迁移，避免部分字段已经增加但版本未更新。")

# 5
heading(doc, "5 注册登录与密码存储", 1)
heading(doc, "5 1 注册唯一性和重复处理", 2)
paragraph(doc, "注册首先使用 Zod 限制用户名和密码，再执行 trim、NFKC 规范化和小写折叠。这样 ALICE、alice 和全角 Ａｌｉｃｅ 会归一为同一个账户名。应用层不采用先 SELECT 再 INSERT 的脆弱流程，而是直接依赖数据库唯一约束处理最终竞争；并发请求中只有一个 INSERT 成功，另一个稳定返回 HTTP 409。")
code(doc, """const username = normalizeUsername(body.username);
if (reservedNames.has(username)) return reply.code(400).send({ error: '该用户名为系统保留名称' });
try {
  db.prepare(`INSERT INTO users(...,role,...) VALUES(?,?,?,'user',...)`)
    .run(id, username, passwordHash, now, now, quota);
} catch (error) {
  if (String(error).includes('UNIQUE'))
    return reply.code(409).send({ error: '用户名已存在' });
  throw error;
}""", "关键实现 并发安全注册 server/src/app.ts")
paragraph(doc, "公开注册永远在 SQL 中固定写入 role=user，客户端不能提交角色。admin、root、system 等保留名称被拒绝；还可以关闭公开注册或启用邀请码。数据库层的 UNIQUE COLLATE NOCASE 是最终防线，解决应用检查和写入之间的竞态。")
figure(doc, ASSETS / "ui-register.jpg", "图 3 注册页面与强密码及普通用户提示", 6.45)
heading(doc, "5 2 密码派生和登录抗枚举", 2)
paragraph(doc, "密码使用 scrypt 派生 32 字节密钥，每次生成 16 字节随机盐，参数为 N=32768、r=8、p=1，最大内存 64 MiB。存储格式包含算法、参数、盐和结果。验证使用 timingSafeEqual，避免按字节提前返回产生时序差异。")
code(doc, """const SCRYPT_N = 32768, SCRYPT_R = 8, SCRYPT_P = 1;
const salt = crypto.randomBytes(16);
crypto.scrypt(password.normalize('NFKC'), salt, 32,
  { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }, ...);

return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);""", "关键实现 密码派生 server/src/security.ts")
paragraph(doc, "登录不存在的用户时仍使用预先生成的 dummy scrypt 哈希执行验证，并统一返回“用户名或密码错误，或账户暂不可用”，降低用户枚举差异。失败控制同时包含全局 IP 限频、用户名和 IP 组合记录，以及账户累计失败次数和指数退避。")
figure(doc, ASSETS / "ui-login.jpg", "图 4 登录页面", 6.45)

# 6
heading(doc, "6 会话令牌与 WebSocket 认证", 1)
figure(doc, make_auth_flow(), "图 5 身份认证与传输授权链路", 6.75)
heading(doc, "6 1 访问令牌和实时撤销", 2)
paragraph(doc, "访问令牌使用 HS256，包含 subject、issuer、audience、签发时间、15 分钟有效期以及 sv 会话版本。服务端验证签名后仍回查 users 表，要求账户 active 且 password_changed_at 与 sv 相同。密码修改、角色变化或其他需要强制下线的操作只要更新该版本，旧访问令牌立即失效，而不是等待到期。")
heading(doc, "6 2 刷新令牌轮换和重放检测", 2)
paragraph(doc, "刷新令牌是 48 字节随机值，只通过 HttpOnly、Secure、SameSite Strict Cookie 传输；数据库保存其 SHA-256。每次刷新把旧记录写入 used_at 和 replaced_by_hash，并在同一 family_id 下创建替代令牌。若已使用或已撤销的令牌再次出现，服务端撤销该族所有令牌，因此窃取旧令牌的攻击不能继续使用新会话。")
code(doc, """if (row.used_at || row.revoked_at) {
  db.prepare('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE family_id=?')
    .run(now, row.family_id);
  return null;
}
db.prepare('UPDATE refresh_tokens SET used_at=?,replaced_by_hash=? WHERE token_hash=?')
  .run(now, replacementHash, hash);""", "关键实现 令牌族重放处置 server/src/auth.ts")
heading(doc, "6 3 一次性 WebSocket 票据", 2)
paragraph(doc, "浏览器原生 WebSocket 不能设置 Authorization 请求头。客户端先用访问令牌调用 POST /api/ws-ticket，服务端在内存中保存票据哈希和用户上下文，30 秒后过期。WSS 升级时 consume 立即删除记录；同一票据第二次使用会被 4401 关闭。票据不进入 URL 日志，Fastify 日志还显式隐藏 Authorization、Cookie 和 Set-Cookie。")

# 7
heading(doc, "7 管理员角色与账户生命周期", 1)
heading(doc, "7 1 初始管理员安全创建", 2)
paragraph(doc, "公开注册不能创建管理员。初始管理员必须在服务器本机运行 create-admin.ps1，脚本使用 Read-Host -AsSecureString 读取密码并通过临时环境变量传给 TypeScript CLI，避免密码进入命令历史。重复创建同名管理员只报告已存在，不修改密码；同名普通用户不会被静默提升，避免攻击者预先注册后获得管理员权限。")
code(doc, """.\\scripts\\create-admin.ps1 -Username admin
.\\scripts\\create-admin.ps1 -Username admin -ResetPassword

# create: 已存在管理员时幂等返回，不修改密码
# reset: 仅允许已有管理员，成功后撤销其全部旧会话""", "本机管理员操作")
heading(doc, "7 2 角色状态和最后管理员保护", 2)
paragraph(doc, "管理员可以显式提升或降低其他用户角色。服务端禁止当前管理员自降权；若目标是最后一个已启用管理员，也禁止降级或禁用。角色变化在 IMMEDIATE 事务中同时更新 role、更新会话版本并撤销刷新令牌，目标用户必须重新登录才能取得新权限。账户禁用同样立即撤销全部刷新令牌。")
code(doc, """if (id === admin.id && role === 'user')
  return reply.code(400).send({ error: '不能降低当前登录管理员自己的权限' });
if (target.role === 'admin' && role === 'user' && target.status === 'active'
    && activeAdminCount(db) <= 1)
  return reply.code(400).send({ error: '系统必须保留至少一个启用的管理员' });""", "关键实现 最后管理员保护 server/src/app.ts")
figure(doc, ASSETS / "ui-admin-controls.jpg", "图 6 管理员角色 带宽 配额和账户状态控制", 6.75)
heading(doc, "7 3 修改密码和会话撤销", 2)
paragraph(doc, "用户必须提交当前密码，新密码不能与当前密码相同，并再次通过强密码策略。修改过程在事务中更新密码哈希、password_changed_at、失败计数和锁定状态，并撤销全部刷新令牌；接口随后签发一套新会话。页面同时提供“撤销所有设备会话”，用于怀疑令牌泄露时立即退出全部设备。")
figure(doc, ASSETS / "ui-account-security.jpg", "图 7 账户安全与全部会话撤销页面", 6.75)

# 8
heading(doc, "8 自定义文件传输协议", 1)
paragraph(doc, "SFT Protocol V1 使用 JSON 文本控制帧和长度前缀二进制数据帧。二进制帧由 4 字节大端 JSON 头长度、UTF-8 JSON 头和原始数据组成。协议头最大 16 KiB，载荷最大 4 MiB；服务端 WebSocket maxPayload 设置为载荷与头部之和，避免在进入业务代码前分配过大内存。")
figure(doc, ASSETS / "protocol-frame.png", "图 8 SFT Protocol V1 二进制帧格式", 6.6)
table(doc, ["字段", "规则", "拒绝条件"], [
    ("v", "固定整数 1", "版本不匹配"), ("type", "判别联合白名单", "未知类型"),
    ("requestId", "8 到 80 字符", "缺失或过长"), ("uploadId fileId", "UUID", "格式错误或不属于用户"),
    ("index", "0 到 totalChunks-1", "越界"), ("offset", "index 乘 chunkSize", "不连续或伪造"),
    ("size", "等于实际载荷且不超过上限", "长度不一致"), ("sha256", "64 位小写十六进制", "重算不一致"),
], [1.15, 3.2, 2.7])
table(doc, ["客户端消息", "服务端响应", "含义"], [
    ("UPLOAD_INIT", "UPLOAD_READY", "创建或恢复上传，返回缺失分块"),
    ("UPLOAD_CHUNK", "CHUNK_ACK", "校验并持久化单个分块"),
    ("UPLOAD_COMPLETE", "UPLOAD_DONE", "整文件验证和原子完成"),
    ("DOWNLOAD_INIT", "DOWNLOAD_META", "验证所有权并声明下载参数"),
    ("无", "DOWNLOAD_CHUNK", "顺序发送带哈希数据块"),
    ("无", "DOWNLOAD_DONE", "发送整文件摘要并结束"),
    ("非法消息", "ERROR", "稳定错误信息，不暴露内部路径"),
], [1.8, 1.8, 3.45])

# 9
heading(doc, "9 安全上传实现", 1)
figure(doc, ASSETS / "upload-sequence.png", "图 9 可恢复上传时序", 6.4)
heading(doc, "9 1 初始化和原子配额预留", 2)
paragraph(doc, "客户端先增量计算整文件 SHA-256，再发送文件名、大小、摘要和期望分块大小。服务端规范化显示名，检查单文件上限和磁盘安全余量，并在 IMMEDIATE 事务中读取已完成文件大小、所有活动上传预留和用户配额。只有 used + reserved + newSize 不超限且活动会话数未达上限时才插入 uploads 记录并创建临时文件。")
code(doc, """const used = SELECT COALESCE(SUM(size),0) FROM files WHERE user_id=?;
const reserved = SELECT COALESCE(SUM(size),0) FROM uploads WHERE user_id=?;
if (used + reserved + size > user.storage_quota_bytes)
  throw new Error('文件会使账户存储配额超限');

// 检查通过后才 INSERT uploads 并创建 UUID 临时文件""", "关键实现 上传前配额预留 server/src/storage.ts")
heading(doc, "9 2 分块校验和耐久确认", 2)
paragraph(doc, "对每个 UPLOAD_CHUNK，服务端验证 uploadId 归属、index、offset、size、实际载荷长度和 SHA-256。写入使用指定 position 循环 write，处理短写；随后执行 FileHandle.sync。只有 sync 完成后才写入 upload_chunks 并返回 CHUNK_ACK，因此客户端看到确认时，该分块已经进入耐久化顺序。")
paragraph(doc, "若同一分块被重传，服务端比较已记录的哈希和长度。完全相同的重传直接幂等确认；内容不同则拒绝，防止攻击者或异常客户端覆盖已确认数据。客户端始终等待当前 CHUNK_ACK 后再发送下一块，天然形成上传背压。")
heading(doc, "9 3 完成校验和版本提交", 2)
paragraph(doc, "UPLOAD_COMPLETE 要求所有分块记录齐全。服务端核对临时文件长度并流式计算整文件 SHA-256；通过后将临时文件 rename 为随机正式名，并在数据库事务中分配同名文件的下一 version、写入 files、删除 uploads。旧版本不被覆盖。若数据库事务失败，程序尝试把正式文件移回临时位置以保留可恢复状态。")
figure(doc, ASSETS / "ui-file-list.jpg", "图 10 上传完成后的文件版本 哈希和操作入口", 6.75)

# 10
heading(doc, "10 下载断点恢复与完整性", 1)
paragraph(doc, "DOWNLOAD_INIT 包含 fileId、分块大小和 offset。服务端以 WHERE id=? AND user_id=? 联合查询，验证 offset 不超过文件长度后发送元数据，并从该位置读取。每个 DOWNLOAD_CHUNK 含 offset、size 和分块 SHA-256；客户端验证摘要和连续偏移后才写入。传输结束后，客户端比较增量整文件哈希与文件元数据中的 sha256。")
code(doc, """if (bytesToHex(sha256(payload)) !== item.value.sha256)
  throw new Error('下载分块完整性校验失败');
if (Number(item.value.offset) !== received)
  throw new Error('下载分块顺序异常');
await writable.write(new Uint8Array(payload));
wholeHash.update(payload);
received += payload.length;""", "关键实现 下载端逐块验证 web/src/protocol.ts")
paragraph(doc, "连接失败时客户端保留已写入字节数和增量哈希状态，重新申请票据并最多重连三次，新 DOWNLOAD_INIT 使用 received 作为 offset。现代 Chromium 使用 File System Access API 直接流式写盘，避免把大文件整体放入内存。旧浏览器回退为 Blob；超过 256 MiB 时主动拒绝回退下载，防止内存耗尽。")
table(doc, ["异常", "处理", "安全结果"], [
    ("连接中断", "指数退避后重新申请票据，从 received 续传", "不重复写入已完成部分"),
    ("分块被修改", "SHA-256 不一致立即中止", "错误内容不写入完成文件"),
    ("偏移乱序", "要求 header.offset 等于 received", "拒绝重排或重复块"),
    ("整文件摘要不符", "最终关闭前再次校验", "不报告下载成功"),
    ("旧浏览器大文件", "超过 256 MiB 拒绝 Blob 回退", "避免客户端内存耗尽"),
], [1.45, 3.2, 2.5])

# 11
heading(doc, "11 存储隔离访问控制与配额", 1)
heading(doc, "11 1 路径安全和随机磁盘标识", 2)
paragraph(doc, "用户文件名只作为显示元数据保存。safeDisplayName 执行 NFC 规范化，拒绝斜杠、反斜杠、控制字符、空字符串、单点和双点。临时文件和正式文件都使用服务端生成的 UUID，用户输入从不参与磁盘路径拼接，因此 ../../ 等路径穿越输入无法控制目标路径。")
heading(doc, "11 2 所有权联合查询", 2)
paragraph(doc, "系统不先按 fileId 查询再在应用层比较用户，而是在每个读取、删除、下载和上传操作中同时匹配资源标识与 user_id。例如下载查询为 WHERE id=? AND user_id=?。攻击者即使得到其他用户的 UUID，也只能得到不存在或无权访问的结果。普通用户不存在列出全部文件或指定任意 user_id 的接口。")
heading(doc, "11 3 配额和删除原子性", 2)
paragraph(doc, "配额计算同时包含已完成文件和 uploads 中的预留大小，防止并发请求各自看到足够空间后共同超限。删除文件采用先 rename 到随机 trash 名、再删除数据库元数据、最后 unlink 的顺序；如果数据库删除失败，则恢复原名。这样避免元数据先消失但磁盘删除失败形成无法管理的孤儿文件。")
table(doc, ["控制点", "约束", "目的"], [
    ("单文件大小", "默认 512 MiB", "限制单请求资源消耗"),
    ("账户配额", "默认 2 GiB，可由管理员调整", "限制长期磁盘占用"),
    ("磁盘余量", "默认至少保留 512 MiB", "避免写满系统盘"),
    ("活动上传", "默认每用户 5 个", "限制临时文件和状态数量"),
    ("同名文件", "分配递增 version", "不覆盖旧数据"),
    ("陈旧上传", "48 小时后定时清理", "回收中断产生的预留和临时文件"),
], [1.45, 2.8, 2.9])

# 12
heading(doc, "12 并发限速与资源安全", 1)
paragraph(doc, "并发策略区分不同用户、不同上传会话和同一上传会话。不同会话可以并行；同一 uploadId 通过 Promise 队列串行执行，避免两个消息同时写同一临时文件。客户端选择多个文件时最多启动三个 worker，服务端每用户默认最多五条 WSS 连接和五个活动上传预留。")
paragraph(doc, "带宽限制由 SerialRateLimiter 按字节数串行等待。优先使用用户 bandwidth_bps，否则使用全局上传或下载速率。下载发送前持续检查 WebSocket bufferedAmount，超过 8 MiB 时暂停；上传逐块 ACK 使客户端不能无限抢跑。上述机制共同限制慢客户端、恶意大包和高并发造成的内存增长。")
code(doc, """async function waitForBackpressure(socket) {
  while (socket.bufferedAmount > 8 * 1024 * 1024
      && socket.readyState === socket.OPEN)
    await new Promise(resolve => setTimeout(resolve, 10));
}

await limiter.consume(payload.length);""", "关键实现 下载背压和用户限速 server/src/websocket.ts")
table(doc, ["资源", "默认边界", "超限行为"], [
    ("HTTP 请求", "每 IP 每分钟 120 次，认证接口更严格", "429 或临时封禁"),
    ("HTTP 请求体", "128 KiB", "框架层拒绝"),
    ("WebSocket 消息", "约 4 MiB 载荷加 16 KiB 头", "协议层关闭或拒绝"),
    ("WSS 连接", "每用户 5 条", "新连接 4429 关闭"),
    ("下载缓冲", "8 MiB", "暂停发送直到下降"),
    ("上传下载带宽", "各 10 MiB/s，可按用户覆盖", "串行等待"),
], [1.55, 2.75, 2.85])

# 13
heading(doc, "13 数据一致性故障恢复与审计", 1)
heading(doc, "13 1 分块崩溃一致性", 2)
paragraph(doc, "分块处理遵循“校验、写文件、fsync、写数据库、ACK”的顺序。若进程在写盘后但数据库提交前崩溃，该分块在恢复时仍被视为缺失，客户端会安全覆盖相同位置；不会出现数据库声称已接收而文件数据尚未持久化的状态。SQLite synchronous FULL 减少断电后事务丢失。")
heading(doc, "13 2 完成和删除补偿", 2)
paragraph(doc, "完成上传时先全文件验证，再 rename，随后提交元数据事务。数据库事务失败时将正式文件移回临时路径。删除则先移入临时 trash 路径，元数据提交失败时恢复。这里采用可补偿文件系统操作配合数据库事务，因为普通文件系统 rename 不能与 SQLite 组成真正的跨资源事务。")
heading(doc, "13 3 审计日志", 2)
paragraph(doc, "注册、登录成功和失败、刷新拒绝、密码修改、全会话撤销、管理员创建、角色变化、状态和配额修改等事件写入 audit_log。detail 最长 4000 字符；日志只记录标识、事件和必要上下文，不记录密码、访问令牌、刷新令牌、WSS 票据或文件内容。数据库触发器拒绝 UPDATE 和 DELETE，使应用通道只能追加。")
table(doc, ["故障位置", "恢复后观察", "为什么安全"], [
    ("分块写入前", "无分块记录", "客户端重传"), ("写盘后数据库前", "仍显示缺失", "相同位置覆盖"),
    ("数据库后 ACK 前", "分块已记录", "相同哈希重传幂等"), ("完成 rename 后事务失败", "尝试移回临时路径", "保留恢复状态"),
    ("删除 rename 后事务失败", "恢复原文件名", "文件和元数据继续一致"), ("上传长期中断", "48 小时清理", "释放配额和临时文件"),
], [1.75, 2.5, 2.9])

# 14
heading(doc, "14 攻击面与安全防护", 1)
table(doc, ["威胁", "已启用控制", "剩余风险和边界"], [
    ("中间人", "TLS 1.2+、证书校验、HSTS、可选 mTLS", "用户错误信任恶意根 CA 时仍有风险"),
    ("密码泄露", "scrypt 随机盐、强密码、统一错误、登录退避", "终端被控制时无法保护输入"),
    ("令牌盗用", "短 JWT、HttpOnly Cookie、轮换、重放撤销、实时状态回查", "单请求处理中存在极短撤销竞态"),
    ("管理员抢注", "公开注册固定 user、本机 CLI、拒绝静默提升", "主机管理员可直接修改数据库"),
    ("SQL 注入", "全部值使用参数占位，Schema 约束输入", "依赖漏洞需持续审计"),
    ("路径穿越", "显示名校验、磁盘 UUID、固定数据目录", "主机文件系统权限超出应用边界"),
    ("水平越权", "资源 id 与 user_id 联合查询", "数据库管理员权限需单独保护"),
    ("内容篡改", "分块与整文件 SHA-256、大小偏移校验", "哈希不能替代离线备份"),
    ("DDoS", "IP 限频、连接消息文件上限、配额、限速、背压、容器资源限制", "大规模分布式攻击需边缘清洗"),
    ("XSS 点击劫持", "Vue 默认转义、CSP、frame-ancestors none、nosniff", "新增富文本时必须重新评估"),
], [1.25, 3.55, 2.35])
paragraph(doc, "安全措施按防御层次组合。TLS 保护传输机密性和身份，应用认证确定用户，联合查询约束授权，哈希保护内容完整性，配额限速与背压约束可用性，WAL 和补偿操作保证故障一致性，审计支持事后追踪。任何单一措施失效时，其他层仍能降低影响。")

# 15
heading(doc, "15 部署运行与操作说明", 1)
heading(doc, "15 1 Windows 本地运行", 2)
paragraph(doc, "运行环境为 Node.js 20.15 以上、npm 和 OpenSSL。start-dev.ps1 会安装依赖、生成本地证书和随机 JWT 密钥、执行生产构建并启动 HTTPS 服务。浏览器访问 https://localhost:8443。实验 CA 仅用于本机演示，正式部署应替换为可信证书。")
code(doc, """cd "D:\\研究生\\软件安全\\lab1"
Set-ExecutionPolicy -Scope Process Bypass
.\\scripts\\start-dev.ps1

# 另开 PowerShell 创建管理员
.\\scripts\\create-admin.ps1 -Username admin""", "Windows 启动命令")
heading(doc, "15 2 正常操作顺序", 2)
numbered_list(doc, [
    "管理员在服务器本机完成创建，普通用户在注册页创建账户。",
    "登录后选择一个或多个文件，客户端先计算整文件 SHA-256，再建立 WSS 传输。",
    "传输任务显示计算、连接、分块、恢复和完整性结果；完成文件进入我的文件列表。",
    "点击下载后，现代 Chromium 选择保存位置并流式写盘；完成前再次验证整文件摘要。",
    "账户安全区域可以修改密码或撤销全部设备会话。",
    "管理员页面可以设置用户带宽、配额、启用状态和角色。",
])
figure(doc, ASSETS / "ui-upload-complete.jpg", "图 11 上传完成后的完整管理员工作台", 6.55)
heading(doc, "15 3 Docker 部署和生产注意事项", 2)
paragraph(doc, "Docker 使用两阶段构建，运行阶段仅包含生产依赖、服务端编译产物和前端静态文件，以 UID 10001 非 root 用户运行。compose 设置只读根文件系统、cap_drop ALL、no-new-privileges、CPU 和内存限制，并将数据目录、证书和 JWT 密钥分离挂载。")
code(doc, """npm run certs
.\\scripts\\create-docker-secret.ps1
docker compose up --build""", "Docker 启动命令")
bullet_list(doc, [
    "正式环境替换实验 CA、服务端证书和 client.p12 演示密码。",
    "JWT 密钥至少 32 字节并通过受保护文件或秘密管理系统提供。",
    "设置真实 PUBLIC_ORIGIN，只开放必要端口，CA 私钥离线保存。",
    "同时备份 sft.sqlite 和 files 目录，并在一致时间点恢复。",
])

# 16
heading(doc, "16 测试证据局限与结论", 1)
heading(doc, "16 1 实际自动化结果", 2)
paragraph(doc, "2026 年 11 月 14 日在 Windows 和 Node.js 20.18.0 环境重新执行生产构建、全部自动化测试和生产依赖审计。前端与服务端构建成功；服务端 15 项、客户端 3 项，共 18 项测试全部通过；npm audit --omit=dev 报告 0 个已知漏洞。")
code(doc, """> npm run build
vite v6.4.6  ✓ built
tsc -p tsconfig.json  ✓

> npm test
server: Test Files 4 passed, Tests 15 passed
web:    Test Files 1 passed, Tests 3 passed

> npm audit --omit=dev
found 0 vulnerabilities""", "实际命令结果摘要")
heading(doc, "16 2 关键测试用例", 2)
table(doc, ["测试", "步骤或输入", "期望和实际结果"], [
    ("重复注册", "alice、ALICE、全角等价名及并发请求", "一个成功，其余 409；通过"),
    ("公开角色", "注册后检查 role", "固定 user；通过"),
    ("令牌重放", "轮换后重放旧 refresh token", "撤销整个 token family；通过"),
    ("禁用账户", "禁用后使用旧访问令牌", "立即 401；通过"),
    ("修改密码", "修改后使用旧访问令牌", "旧令牌 401，新会话可用；通过"),
    ("角色变化", "提升、降级、自降权", "目标会话撤销，自降权拒绝；通过"),
    ("敌意 Origin", "Origin=https://evil.example", "403；通过"),
    ("审计篡改", "DELETE audit_log", "触发器拒绝；通过"),
    ("配额预留", "配额 1 MiB 上传 2 MiB", "建立临时文件前拒绝；通过"),
    ("上传会话上限", "上限 1 后创建第二会话", "拒绝；通过"),
    ("同名版本", "连续上传 report.txt", "保留 v1 和 v2；通过"),
    ("协议异常", "头长度和载荷长度不一致", "解码拒绝；通过"),
    ("分块哈希", "修改载荷保留旧摘要", "不记录分块；人工计划"),
    ("越权下载", "用户 A 请求用户 B fileId", "联合查询拒绝；人工计划"),
    ("断点恢复", "上传下载中断后恢复", "仅传缺失部分且最终哈希一致；人工计划"),
], [1.35, 3.0, 2.75])
heading(doc, "16 3 局限与改进", 2)
paragraph(doc, "SQLite WAL 适合本实验的单机并发，但不支持多实例共享写入。大规模部署应迁移到 PostgreSQL，把一次性票据放入 Redis，把文件放入支持校验和版本的对象存储。应用内限频只能缓解 DDoS，公网服务仍需要防火墙、反向代理或流量清洗。")
paragraph(doc, "流式下载依赖 Chromium File System Access API；其他浏览器的大文件体验受限。审计表虽然由触发器保护追加语义，但拥有数据库文件写权限的主机管理员仍可离线替换数据库。高安全环境应把审计事件异步发送到独立的远程只追加存储，并建立一致性备份和恢复演练。")
heading(doc, "16 4 实验结论", 2)
paragraph(doc, "Sentinel Transfer 已完成实验 1B 的多用户、并发、完整文件传输、长连接和自定义协议要求，并实现断点续传、公钥证书、可选 mTLS、多文件并行、用户级带宽、存储配额、角色治理和实时会话撤销。实现重点不是单纯增加功能数量，而是让认证、授权、协议、存储和恢复保持一致。")
paragraph(doc, "系统通过数据库唯一约束解决重复注册竞争，通过 scrypt 和统一登录路径保护凭据，通过令牌族和一次性票据限制会话重放，通过分块与整文件 SHA-256 验证传输内容，通过 fsync 和事务顺序保证恢复语义，通过随机磁盘标识和 user_id 联合查询隔离文件。18 项自动化测试、生产构建和依赖审计均已通过，项目具备可复现、可演示和可继续扩展的基础。")

heading(doc, "附录 A 主要接口", 1)
table(doc, ["方法", "路径", "认证", "作用"], [
    ("GET", "/api/config", "无", "公开注册和文件上限配置"),
    ("POST", "/api/auth/register", "无", "注册普通用户"),
    ("POST", "/api/auth/login", "无", "登录并建立会话"),
    ("POST", "/api/auth/refresh", "刷新 Cookie", "轮换刷新令牌"),
    ("POST", "/api/auth/change-password", "Bearer", "修改密码并撤销旧会话"),
    ("POST", "/api/auth/logout-all", "Bearer", "撤销全部设备会话"),
    ("GET", "/api/files", "Bearer", "列出当前用户文件"),
    ("DELETE", "/api/files/:id", "Bearer", "删除当前用户文件"),
    ("POST", "/api/ws-ticket", "Bearer", "签发 30 秒一次性票据"),
    ("GET", "/api/admin/users", "管理员", "列出用户资源和状态"),
    ("PATCH", "/api/admin/users/:id/settings", "管理员", "配额带宽和状态"),
    ("PATCH", "/api/admin/users/:id/role", "管理员", "显式角色变更"),
], [0.8, 2.5, 1.15, 2.6])

heading(doc, "附录 B 关键文件", 1)
table(doc, ["文件", "职责"], [
    ("server/src/app.ts", "TLS 安全头 API 认证管理和输入校验"),
    ("server/src/auth.ts", "访问令牌 刷新令牌族 实时撤销和一次性票据"),
    ("server/src/db.ts", "数据库表 事务迁移 WAL 和追加审计"),
    ("server/src/storage.ts", "配额预留 分块写入 整体校验 完成和删除补偿"),
    ("server/src/websocket.ts", "WSS 生命周期 心跳 消息分派 下载背压和限速"),
    ("server/src/security.ts", "scrypt 用户名规范化 文件名安全和随机令牌"),
    ("web/src/api.ts", "访问令牌内存保存 自动刷新和账户接口"),
    ("web/src/protocol.ts", "协议编解码 上传 下载 哈希和自动恢复"),
    ("web/src/App.vue", "并行任务 界面 账户安全和管理员控制"),
    ("docs/TEST_PLAN.md", "功能 安全和稳定性复现步骤"),
], [2.5, 4.65])

doc.core_properties.title = "实验 1B 安全文件传输系统设计与实现"
doc.core_properties.subject = "软件与系统安全实验报告"
doc.core_properties.author = "请填写姓名"
doc.core_properties.keywords = "安全文件传输 WSS 断点续传 SHA-256 TLS scrypt SQLite"
doc.save(OUTPUT)
print(OUTPUT)
