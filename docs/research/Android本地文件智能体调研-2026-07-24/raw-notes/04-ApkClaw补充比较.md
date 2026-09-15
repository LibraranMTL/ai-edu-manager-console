# ApkClaw 补充比较

## 1. 原生运行时

来源：https://github.com/apkclaw-team/ApkClaw

ApkClaw 的 agent loop、远程模型调用、ToolRegistry 和无障碍执行层都在 Android APK 内，不依赖 Termux 或远程 Gateway。它使用 LangChain4j 对接 OpenAI-compatible 与 Anthropic-compatible 模型，模型推理可在远程完成，符合“不需要本地推理、但智能体运行时在设备上”的部署要求。Apache 2.0 许可也比 PalmClaw 的 AGPLv3 更易用于商业代码参考。

## 2. 文件能力

来源：https://raw.githubusercontent.com/apkclaw-team/ApkClaw/main/app/src/main/java/com/apk/claw/android/tool/ToolRegistry.kt

公开 ToolRegistry 主要注册屏幕读取、截图、输入、打开应用、剪贴板和手势工具。没有目录列举、文件读取、全文搜索、写入、移动或删除工具。唯一文件能力 `send_file` 只是把指定绝对路径文件通过消息通道发送给用户。因此它是 GUI 自动化 agent，不是文件工作区 agent。

## 3. 存储边界

来源：https://raw.githubusercontent.com/apkclaw-team/ApkClaw/main/app/src/main/java/com/apk/claw/android/tool/impl/SendFileTool.java

`send_file` 接收任意绝对路径并检查所有文件访问权限，没有 SAF document tree、相对路径工作区或 workspace resolver。Manifest 申请 `MANAGE_EXTERNAL_STORAGE`。这对个人自动化工具可能方便，但不适合学生资料：模型一旦错误或被诱导调用工具，理论访问面是整台设备，而非用户明确授权的项目目录。

## 4. 工具审批与凭据

来源：https://raw.githubusercontent.com/apkclaw-team/ApkClaw/main/app/src/main/java/com/apk/claw/android/agent/DefaultAgentService.kt

agent loop 把模型返回的 tool call 直接交给 ToolRegistry 执行，没有发现按工具风险分级的 approval gate。公开源码把 LLM key 和通道 secret 写入默认 MMKV，未看到 crypt key。可选 LAN 配置服务的 GET 接口返回完整 key/secret，未发现身份认证，且网络配置允许明文流量。因此这些模块不应进入教育产品，必须用 Android Keystore、鉴权、TLS 和最小暴露面重写。

## 5. 成熟度

来源：https://github.com/apkclaw-team/ApkClaw/releases/tag/v0.0.2

审计提交为 `1b8d40fad417618f63f62af73fdfe688796dabad`，公开仓库只有 3 个提交，最新版为 0.0.2。仓库有 debug/release 构建脚本和 APK release，但仅有两个 Android 模板测试，没有 agent loop、文件边界、凭据、配置服务或工具审批测试。因此可用于源码阅读和独立实验，不能直接视为教育场景的成熟底座。

## 6. 与 PalmClaw 的直接结论

| 维度 | PalmClaw | ApkClaw |
|---|---|---|
| 目标 | 私人移动 agent 与文件/技能工作区 | 跨 App GUI 自动化 |
| 文件工具 | 完整 | 只有 `send_file` |
| 工作区路径控制 | 有 resolver | 无，使用绝对路径 |
| 高风险确认 | 文件覆盖/递归删除等有确认 | agent 工具调用直接执行 |
| Android 权限 | 仍有所有文件访问问题 | 所有文件、无障碍、悬浮窗等更宽 |
| 许可证 | AGPLv3/商业双许可 | Apache 2.0 |
| 教育文件智能体适配 | 高，但要替换为 SAF | 低，需重写文件与安全层 |

结论：如果目标是“Android 本地文件智能体”，PalmClaw 的功能架构更接近；如果目标是“让智能体操作其他 Android App”，ApkClaw 更直接。AI 教育管家应只参考 ApkClaw 的 Apache 2.0 原生 agent/tool 组织，不应以其现有权限和文件模型作为学生端底座。
