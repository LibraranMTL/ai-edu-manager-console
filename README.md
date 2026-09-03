# AI教育管家控制台 App

版本历史与发布规则见 [CHANGELOG.md](CHANGELOG.md)。

当前产品采用一个 Windows 主机与三类终端协同的四端结构：

- Windows 主机端 0.16.8：供教师或家长管理学生、项目、资料治理、成长模型、学情报告、教育档案、精选课程及终端连接；支持完整换机迁移、单学生 U 盘导出到 Android 单机版、学生原始资料库与学生知识库独立重绑定，以及跨主机学生档案同步；
- Windows 学生端 0.16.8：采用适合中小学生的横屏学习工作台，支持个人终端和共享终端、资料上传与屏幕采集、精选课程，以及表格等 Markdown 学情档案的正确渲染；
- Android 学生端 0.6.16：采用横屏三列、竖屏与中等宽度两列的自适应方块卡片布局；支持个人终端和共享终端，学生可扫码或输入个人 ID 后上传资料、查看本人报告、档案、关联项目知识和精选课程；
- Android 教师端 0.1.0：以独立紫红色应用连接主机，可检索全部学生，选择学生及其关联项目，将收集资料写入对应的主机原始资料库，并查看学情报告、成长模型、教育档案和项目知识。

学生端资料入口只在当前学生范围内选择学生原始资料库或绑定项目原始资料库。共享学生终端使用扫码或个人 ID 建立单学生会话，不暴露学生名单，也不暴露主机端的档案初始化、项目管理和知识治理功能。Android 教师端则直接选择主机中的学生及其关联项目；上传结果进入 Windows 主机资料库，不向学生设备发送文件、通知或已读任务。教师端保留按学生和项目隔离的档案缓存，以便断开连接后继续查看已缓存内容。

主机端“精选课程”分为“课程学习”和“课程管理”：课程学习用于打开已启用课程；课程管理向已激活的专业版、机构版和平台版开放。“机构精选课程”由本机四字段表单或 Excel 导入，只下发给本机构学生；“平台精选课程”由平台版用相同四字段形成平台课程包，供其他主机导入。平台版 License 是唯一发布权限，课程包只保留版本、文件 SHA-256 和完整性校验，不配置课程发布密钥。课程链接优先使用 HTTPS，也兼容目录中明确登记域名的 HTTP；金榜学霸旧 HTTPS 地址会自动迁移为其实际可用的 HTTP 地址。主机课程视图随侧栏折叠实时重排，并提供全屏学习。第三方页面仍在受限浏览容器中打开，页面顶部显示“待开始”采集条，必须先选择学生、项目和屏幕后主动开始。

Windows 主机端提供“教育内容智能出版”：当前学生的学情报告和教育档案可生成 PDF、PNG 或 Markdown，支持正式报告、简明报告、成长要点、彩色和黑白模板，并可在输出前编辑派生草稿。默认“忠实原文”不调用 Agent；可选“Agent 智能提炼”要求每条结论携带可核对的原文摘录和来源章节，校验不通过时自动回退到忠实原文稿。卡片式输出使用 9:16 手机比例并按内容密度自动排版，不反向修改原始报告、教育档案、成长模型或知识资产。

两台完整 Windows 主机可在“系统设置 → 知识协作”建立角色中立的协作关系，定向发布项目、交换任务，并按授权范围查询本机或远程知识。教育管家问答采用本地优先、局域网优先、Tailscale 回退和带时间离线快照；团队范围查询由“允许本机团队知识查询”和“允许远程协作团队知识查询”两个长期策略控制。用户明确要求时，QClaw/Codex 可把当前或选定对话作为可追溯候选投递到指定学生或关联项目，不后台抓取全部私有历史。

知识协作不会默认双向同步学生原始资料。项目原始资料使用“发布项目”，其他原始资料使用明确上传或投递；自动档案通道仅面向已确认知识、成长模型、已发布报告和最新完整教育档案，并且只在双方存在唯一的一对一学生 ID 映射时运行。用户可按学生暂停或立即同步；映射不明确时系统停止写入，不按姓名猜测。团队查询和明确对话投递已经完成双机真机验证；QClaw 远程知识路由与运行期间档案自动更新仍按执行看板保留受控复测门禁。

当前操作手册见 `docs/delivery/Windows主机版操作手册.md`、`docs/delivery/Windows学生终端操作手册.md`、`docs/delivery/Android学生终端操作手册.md` 和 `docs/delivery/Android教师终端操作手册.md`。

## 第一版定位

- 不嵌入 QClaw 和 Obsidian。
- 不绕过 QClaw 登录。
- App 负责收集学生信息、生成档案模板、生成 QClaw 初始化指令、打开外部应用。
- QClaw 负责创建 Agent 和每日定时资料消化任务。
- Obsidian 负责查看学生学情档案。

## 本地运行

```powershell
pnpm install
pnpm dev
```

## 构建

```powershell
pnpm build
```

## Android 打包路线

Android 教师端使用仓库内的独立原生构建路线：

```powershell
powershell -ExecutionPolicy Bypass -File android-teacher-terminal\build.ps1
```

以下 Capacitor 路线仅用于早期 Android Web/PWA 原型，不是当前教师终端 APK 的构建方式。

当前工程已预置 Capacitor 配置。安装 Android Studio / Android SDK 后执行：

```powershell
pnpm add @capacitor/core @capacitor/cli @capacitor/android
pnpm build
npx cap add android
npx cap sync android
```

然后用 Android Studio 打开 `android/` 目录打包 APK。

## Android 文件能力说明

浏览器/PWA 不能直接静默创建任意公共目录。真正 APK 版本建议接入 Capacitor Filesystem 或自定义 Android 原生插件，用于：

- 在用户授权后创建 `Documents/学生资料/{学生名}知识库`
- 写入 `AGENT.md`、`Soul.md`、`Memory.md`
- 调用外部 App：QClaw、Obsidian
- 记录初始化状态

第一版 Web/PWA 原型先提供“下载初始化包”和“复制 QClaw 指令”，用于验证销售和交付流程。

## 0.4.5 Windows 主机控制台发布说明

- Windows 主机控制台版本：`0.4.5`，发布物：`release/windows/AI-edu-manager-console-Windows-0.4.5.exe`。
- Android 平板终端版本保持：`0.4.3`，发布物：`release/tablet-terminal/AI-edu-manager-tablet-terminal-0.4.3.apk`。
- 新增“接管已有知识库 + 绑定已有 Agent 工具”：可登记既有 QClaw、Hohu、Marvis、OpenClaw 学生知识库，不移动、不复制、不删除旧文件。
- Agent 工具新增 OpenClaw，补齐安装检测、打开状态、打开按钮、下载入口和初始化提示。
- 上传资料、档案浏览、消化指令、Soul 工作规则统一使用学生记录中的真实知识库路径。

### 0.4.5 更新清单建议字段

```json
{
  "versionCode": 55,
  "versionName": "0.4.5",
  "windowsVersionCode": 55,
  "windowsVersionName": "0.4.5",
  "windowsUrl": "https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.4.5.exe",
  "tabletTerminalVersionCode": 53,
  "tabletTerminalVersionName": "0.4.3",
  "tabletTerminalApkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.4.3.apk",
  "apkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.4.3.apk",
  "notes": "Windows 0.4.5：新增接管已有知识库与绑定已有 Agent 工具能力，支持标准知识库和接管知识库并存；Agent 工具新增 OpenClaw，并同步安装检测、打开状态、初始化指令、Soul 工作规则和资料路径。平板终端 0.4.3 保持不变。"
}
```

## 0.4.0 双端收敛说明

- Windows 主机控制台版本：`0.4.0`，发布物：`release/windows/AI-edu-manager-console-Windows-0.4.0.exe`。
- Android 平板终端版本：`0.4.0`，发布物：`release/tablet-terminal/AI-edu-manager-tablet-terminal-0.4.0.apk`。
- Windows 默认学生根目录：`D:\学生资料`。
- 平板终端只保留客户功能：连接主机、上传资料到主机、查看学情档案、联系教育管家、连接状态与系统设置。
- Windows 主机端保留管理员功能：学生初始化、QClaw 辅助、主机服务、扫码配对、设备授权、上传记录、备份恢复、安全诊断。

### 0.4.0 新增交付能力

- 主机数据备份与恢复：导出/恢复学生索引、设备授权、上传记录和主机事件。
- 主机上传状态闭环：上传记录可标记为“待消化 / 已提交消化 / 已处理完成”。
- 安全与诊断：上传文件类型和大小限制、API Token 重置、诊断日志导出。
- 首次使用清单：Windows 首页显示创建学生、启动服务、绑定平板、上传资料的完成状态。
- 平板终端更新与诊断：支持检查更新、复制诊断信息给售后排查。

### 更新清单建议字段

```json
{
  "versionCode": 50,
  "versionName": "0.4.0",
  "windowsVersionCode": 50,
  "windowsUrl": "https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.4.0.exe",
  "tabletTerminalVersionCode": 50,
  "tabletTerminalVersionName": "0.4.0",
  "tabletTerminalUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.4.0.apk",
  "apkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.4.0.apk",
  "notes": "0.4.0：双端交付稳定性增强，包含备份恢复、上传状态闭环、诊断日志和平板终端更新检查。"
}
```
