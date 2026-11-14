# Sentinel Transfer 实验 1B

Sentinel Transfer 是一个面向《软件与系统安全》实验 1B 的安全文件传输系统。客户端通过 HTTPS 完成账户操作，通过持久 WSS 连接执行自定义应用层协议。传输采用固定大小分块、逐块确认、SHA-256 双层校验和可恢复上传；服务端使用随机磁盘标识、用户所有权检查、参数化 SQL、速率限制和审计日志保护数据。

## 已实现功能

- 多用户注册、登录、访问令牌和刷新令牌族轮换；重放会撤销整个令牌族。
- 公开注册永远只能创建普通用户；管理员仅能通过服务器本机交互命令创建。
- 账户禁用、改密、全会话撤销立即生效，访问令牌使用时回查数据库状态。
- HTTPS 与 WSS 长连接，TLS 最低版本为 1.2，可选双向证书认证。
- 自定义 SFT Protocol V1：长度前缀协议头、二进制载荷、请求编号、分块编号、偏移量和哈希。
- 分块上传、逐块 ACK、掉线自动重连、断点续传和整文件 SHA-256 校验。
- 多文件最多三个并行任务；服务器限制每个用户的并发 WSS 连接数。
- 文件下载逐块校验；支持断线自动恢复，现代 Chromium 浏览器直接流式写盘，避免大文件占满内存。
- 每用户文件所有权隔离、随机存储名、路径穿越防护和原子完成/删除流程。
- 同名文件使用不可覆盖的显式版本号；管理员可配置带宽、存储配额与账户状态。
- 管理员可显式提升或降低其他用户的角色；系统禁止自降权和删除最后一个启用的管理员，角色变化会撤销目标会话。
- 登录同时按 IP、用户名/IP 和账户累计失败次数退避锁定；支持邀请注册和关闭公开注册。
- 上传前原子预留用户配额，并检查并发上传会话数与磁盘安全余量。
- SQLite 版本化事务迁移、参数化查询、WAL、外键、FULL 同步和数据库触发器保护的追加式审计日志。
- Docker 非 root、只读根文件系统、最小 capabilities 和资源限制部署。
- TypeScript 严格编译、协议/认证自动化测试和依赖漏洞审计。

## 目录结构

```text
server/       Fastify 服务端、WSS 协议、认证、存储和测试
web/          Vue 客户端、并发传输队列、完整性校验和测试
scripts/      证书、密钥和本地启动脚本
docs/         威胁模型、测试方案、协议说明和演示脚本
report/       可提交的实验报告
certs/        本地 CA、服务端及客户端证书（密钥被 Git 忽略）
data/         运行数据（被 Git 忽略）
```

## Windows 一键启动

需要 Node.js 20.15 或更高版本、npm 和 OpenSSL。PowerShell 中运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\start-dev.ps1
```

脚本会安装依赖、生成本地 CA 与证书、生成随机 JWT 密钥、执行生产构建并启动服务。浏览器打开 `https://localhost:8443`。本地 CA 未被系统信任时，浏览器会显示证书警告；可将 `certs/ca.crt` 导入“受信任的根证书颁发机构”，仅限实验环境。

公开注册账户始终是普通用户。另开一个 PowerShell 窗口，在服务器本机执行下列命令创建初始管理员（密码不会进入命令行或 shell 历史）：

```powershell
.\scripts\create-admin.ps1 -Username admin
```

该命令可以安全重复执行：管理员已经存在时只显示状态，不修改密码。若忘记管理员密码，在服务器本机显式执行 `.\scripts\create-admin.ps1 -Username admin -ResetPassword`；重置成功后，该管理员的全部旧会话都会被撤销。为防止账户劫持，脚本不会把已有普通账户静默提升为管理员。密码至少 12 位，并须包含大写字母、小写字母、数字和特殊字符。若需关闭注册或启用邀请码，设置 `REGISTRATION_ENABLED=false` 或 `REGISTRATION_INVITE_CODE`。

登录后可通过页面右上角的“修改密码”直接跳到账户安全区域。管理员可在“用户安全与资源策略”中调整其他账户的角色；从旧版升级后若保留了“首个用户管理员”，可在确认新管理员可正常登录后将旧账户降为普通用户。

运行数据由 SQLite 数据库 `data/sft.sqlite` 保存用户、会话、配额、文件元数据、上传进度和审计记录；文件内容使用随机 UUID 名称保存在 `data/files`，不会以用户提供的文件名作为磁盘路径。

## Docker 部署

先生成证书和 Docker JWT 密钥：

```powershell
npm run certs
.\scripts\create-docker-secret.ps1
docker compose up --build
```

生产部署必须替换演示 CA 与证书、保护 `secrets/jwt_secret`、配置真实 `PUBLIC_ORIGIN`，并通过防火墙只开放 8443 端口。

## 双向证书认证

证书脚本会同时生成 `client.p12`，演示导入密码为 `lab1-demo-only`。将其导入客户端系统后，使用 `.\\scripts\\start-dev.ps1 -MutualTls` 启动。服务器将要求客户端出示由实验 CA 签发的证书。正式环境不得继续使用演示密码或保留 CA 私钥在服务主机上。

## 验证命令

```powershell
npm run build
npm test
npm audit --omit=dev
```

三条命令应分别完成严格 TypeScript 构建、服务端与客户端测试、生产依赖漏洞审计。完整的人工与攻击测试步骤见 `docs/TEST_PLAN.md`。

## 提交前必须修改

1. 在 `report/实验1B安全文件传输系统实验报告.docx` 封面填写姓名、学号和 Git 仓库地址。
2. 按 `docs/DEMO_SCRIPT.md` 录制编译、部署、正常传输、断点续传、并发与安全测试。
3. 将代码推送到 GitHub、Gitee 或 GitLab，确保提交记录完整。
4. 按课程命名要求整理源码、视频和报告后，只使用 ZIP 压缩提交。

录制 MP4 并填写报告封面后，可使用打包脚本生成符合课程命名要求且不包含 `node_modules`、数据库、私钥或 JWT 密钥的 ZIP：

```powershell
.\scripts\package-submission.ps1 -Name 张三 -StudentId 202618008829001 -VideoPath D:\视频\实验1B.mp4
```

