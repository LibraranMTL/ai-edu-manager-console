# AI教育管家控制台 App

版本历史与发布规则见 [CHANGELOG.md](CHANGELOG.md)。

当前产品采用三端结构：

- Windows 主机端 0.15.3：供教师或家长管理学生、项目、资料治理、成长模型、学情报告、教育档案、精选课程及学生终端使用模式；
- Windows 学生端 0.15.3：支持个人终端和共享终端，供学生上传文件、主动采集屏幕资料，并打开当前学生获分配的精选课程；
- Android 学生端 0.6.9：支持个人终端和共享终端，学生可扫码或输入个人 ID 后上传资料、查看本人报告、档案、关联项目知识和精选课程。

三端资料入口均可在当前学生范围内选择学生原始资料库或绑定项目原始资料库。共享学生终端使用扫码或个人 ID 建立单学生会话，不暴露学生名单，也不暴露主机端的档案初始化、项目管理和知识治理功能。

主机端“精选课程”分为“课程学习”和“课程管理”：课程学习用于打开已启用课程；课程管理仅向已激活的专业版和机构版开放。平台内容使用版本化签名目录，专业版和机构版还可下载四字段 Excel 模板，以“课程名称、课程图片、课程简介、课程链接”导入机构自选课程。两类课程均可设置启用、隐藏、排序、年级和学生分配；学生端只接收当前学生有效课程。第三方页面在受限浏览容器中打开，课程资料采集默认处于“待开始”，必须由用户主动发起系统录屏授权；打开网页或采集资料不等于课程完成、正确率或学情结论。

两台完整 Windows 主机可在“系统设置 → 知识协作”建立角色中立的协作关系，定向发布项目、交换任务，并按授权范围查询本机或远程知识。教育管家问答采用本地优先、局域网优先、Tailscale 回退和带时间离线快照；团队范围查询由“允许本机团队知识查询”和“允许远程协作团队知识查询”两个长期策略控制。用户明确要求时，QClaw/Codex 可把当前或选定对话作为可追溯候选投递到指定学生或关联项目，不后台抓取全部私有历史。

知识协作不会默认双向同步学生原始资料。项目原始资料使用“发布项目”，其他原始资料使用明确上传或投递；自动档案通道仅面向已确认知识、成长模型、已发布报告和最新完整教育档案。团队查询和明确对话投递已经完成双机真机验证；QClaw 远程知识路由与运行期间档案自动更新仍按执行看板保留受控复测门禁。

当前操作手册见 `docs/delivery/Windows主机版操作手册.md`、`docs/delivery/Windows学生终端操作手册.md` 和 `docs/delivery/Android学生终端操作手册.md`。

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
