# 原生 Android 智能体候选

## PalmClaw

来源：https://github.com/ModalityDance/PalmClaw

PalmClaw 是目前最贴近目标的公开实现。其运行时、agent loop、skills、tools、memory 和 provider 适配都位于 Android 应用内部，不需要外部 Gateway，也不需要 Termux。用户安装 APK 并配置自己的远程模型 API key。源码包含较完整的文件列举、读取、写入、编辑、搜索、移动和删除工具，以及工作区路径解析与高风险确认。问题是默认 AGPLv3/商业双许可和 `MANAGE_EXTERNAL_STORAGE`，因此适合作为隔离验证和架构样板，不宜直接无审查合并。

## X-OmniClaw

来源：https://github.com/OPPO-Mente-Lab/X-OmniClaw

X-OmniClaw 同样把 agent loop、tool registry、文件读写编辑工具和远程模型 provider 放在原生 Android 工程中，且使用 Apache 2.0。它证明了不依赖 Linux 环境的另一种实现路径。但项目主要目标是多模态跨应用自动化，要求无障碍、悬浮窗、录屏、所有文件、相机、麦克风等权限，远超文件智能体 P0 所需。可参考代码分层，不应照搬权限面和自动化范围。

## 官方 OpenClaw Android

来源：https://docs.openclaw.ai/platforms/android

官方文档明确把 Android 定义为 companion node，Gateway 必须在其他计算机上运行。Android 端的 workspace 文件也是通过 Gateway RPC 浏览且只读。它不符合“智能体运行时在 Android、本地处理文件”的需求，不能作为目标实现。

## CellClaw

来源：https://cellclaw.com/

官网宣称原生 Android、自主 agent loop、33 个工具、直接连接用户模型 provider、Apache 2.0，并有 file.read/write/list 与分级授权策略。不过官网指向的 GitHub 仓库在审计日返回 404，无法验证源码、构建和许可证。暂时只能作为观察对象，不能列为可采用代码。

## Google AI Edge

来源：https://github.com/google-ai-edge/gallery

Google AI Edge Gallery 与 LiteRT-LM 展示了 Android/Kotlin 工具调用和端侧模型能力，但核心定位是本地推理与模型体验。用户已明确不需要本地推理，因此它们不是 P0 运行时选择，只适合作为未来离线模型后端的参考。
