# ApkClaw 源码审计回执

> 审计日期：2026-07-24
> 仓库：https://github.com/apkclaw-team/ApkClaw
> 提交：`1b8d40fad417618f63f62af73fdfe688796dabad`
> 公开版本：`0.0.2`
> 许可证：Apache-2.0

## 已核验事实

| 检查项 | 结果 | 源码位置 |
|---|---|---|
| agent loop 是否在 APK 内 | 是 | `agent/DefaultAgentService.kt` |
| 是否需要 Termux | 否 | 原生 Android Gradle 工程 |
| 是否支持远程模型 | 是 | `agent/llm/`、`AgentConfig.kt` |
| 是否有完整本地文件工具 | 否 | `tool/ToolRegistry.kt` |
| 当前文件工具 | `send_file` | `tool/impl/SendFileTool.java` |
| 文件路径边界 | 任意绝对路径，无 SAF workspace | `SendFileTool.java` |
| 存储权限 | `MANAGE_EXTERNAL_STORAGE` | `AndroidManifest.xml` |
| 设备自动化 | 无障碍、截图、手势、App 调度 | `ClawAccessibilityService`、ToolRegistry |
| 运行时工具审批 | 未发现独立 approval gate | `DefaultAgentService.kt` 直接调用 `ToolRegistry.executeTool` |
| LLM key 保存 | 默认 MMKV，未见 crypt key | `utils/KVUtils.kt` |
| LAN 配置 | NanoHTTPD，端口 9527 | `server/ConfigServer.kt` |
| LAN GET 凭据返回 | 完整 LLM key 和 channel secret | `ConfigServer.kt` |
| 明文网络 | 允许 | `res/xml/network_security_config.xml` |
| 公共测试 | 2 个 Android 模板示例 | `src/test`、`src/androidTest` |

## 文件能力判定

公开 `ToolRegistry` 注册：

- 屏幕结构、元素查找、截图；
- 输入、返回、主页、最近任务；
- 打开 App、列举已安装 App；
- 点击、长按、滑动、滚动查找；
- 剪贴板；
- `send_file`；
- finish、wait、repeat。

未注册：

- `list_files`
- `read_file`
- `search_text`
- `write_file`
- `append_file`
- `rename_file`
- `move_file`
- `delete_file`

所以 ApkClaw 能操作文件管理器界面，也能按绝对路径外发文件，但不是具有结构化本地文件工作区的智能体。

## 产品结论

ApkClaw 可作为以下模块的参考：

- LangChain4j 在 Android 上的适配；
- OpenAI/Anthropic provider；
- agent loop 与 ToolRegistry；
- 飞书、钉钉、QQ、Discord、Telegram 等 channel adapter；
- 无障碍手机自动化的独立实验。

不应直接进入学生端的部分：

- `MANAGE_EXTERNAL_STORAGE`；
- 绝对路径 `send_file`；
- 模型 tool call 直接执行；
- 未加密的默认 MMKV secret 保存；
- 未鉴权的 LAN 配置面；
- `cleartextTrafficPermitted=true`；
- 无障碍、悬浮窗、安装 APK、查询全部应用等 P0 非必要权限。

最终排序：

1. 本地文件智能体架构样板：PalmClaw；
2. Apache 2.0 原生 agent/tool 参考：X-OmniClaw、ApkClaw；
3. 跨 App 自动化样板：ApkClaw；
4. AI 教育管家实际实现：自建 SAF 有界 `LocalAgentRuntime`。
