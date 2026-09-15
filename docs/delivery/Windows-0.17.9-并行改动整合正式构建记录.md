# Windows 主机端 0.17.9 正式发布记录

## 发布范围

- 发布日期：2026-09-15（Asia/Shanghai）。
- 正式发布 Windows 主机端 0.17.9 便携版 EXE、ZIP、在线版本清单、下载中心页面和 Windows 主机端操作手册。
- 整合授权后 Agent 会话采集、一次 Codex Hook 信任后的自动复核与复用、学习时间线与语义处理、成长/报告证据回链、主导航与页面优化，以及项目绑定学生性能修复。
- 已打开的 Codex 会话只从授权后的下一条用户提问开始采集；不扫描授权前历史或漏采轮次。
- Windows 学生端 0.17.8 继续保持候选状态；官网学生端正式下载仍为 0.16.10。Android 各端不随本次 Windows 主机发布升级。

## 真机验收结论

- 用户已确认 r6 候选包真机测试通过，本次正式 EXE 与已验收候选 EXE 的 SHA-256 完全相同。
- Codex 首次通过 `/hooks` 信任 `EDU-MANAGER-LIFECYCLE` 后，后续新会话和已打开会话的授权后新轮次能够自动采集；Hook 定义未变化时无需重复确认。
- “已有项目”编辑绑定学生改为局部选择、一次异步保存和后台配置刷新；连续选择交互无原同步链路卡顿。

## 自动验证

- 全量 Node 测试：996 项，995 通过、1 跳过、0 失败。
- Vite 正式构建：3,712 个模块转换成功；构建脚本检查 83 个渲染文件、68 个资源均可达。
- 源码、暂存运行时和打包产物的敏感信息扫描均为 0 项发现。
- 包内确认包含 `electron/main.cjs`、`electron/preload.cjs` 和 `electron/codex-hook-onboarding.cjs`。
- Authenticode：`NotSigned`。发行者元数据不是代码签名，分发时须如实告知。

## 正式产物

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.17.9.exe` | 90,988,750 | `06B860D885D709463049F8B4C98E051A72844A4EDA7747E3DD850D55F8E54179` |
| `release/windows/AI-edu-manager-console-Windows-0.17.9.zip` | 90,997,477 | `8FF275E15F297BB97FAC4CE78AE10E9F9912B86B33A814C47460AA8C4D4296BD` |

构建审计：`release/windows/AI-edu-manager-console-Windows-0.17.9-build-audit.json`。

## 发布与回滚

- 在线主清单：`/download/edu-manager-version.json`；产品站清单副本：`/education/edu-manager-version.json`。
- 下载页与主机手册：`/education/download.html`、`/education/windows-host-manual.html`、`/education/windows-manual.html`。
- 正式安装包：`/download/AI-edu-manager-console-Windows-0.17.9.exe`、`/download/AI-edu-manager-console-Windows-0.17.9.zip`。
- ECS 发布采用独立暂存目录、逐文件 SHA-256 校验、时间戳备份和同目录原子替换；实际备份路径与线上验证结果在本次发布操作完成后记录于交付回执。

## 已知边界

- Windows 安装包尚未完成 Authenticode 公共代码签名；Windows 可能显示未知发布者提示。
- 自动采集依赖目标 Agent 提供受支持的生命周期 Hook 或本应用自身受控调用链；不读取其他应用私有数据库，也不绕过 Codex 对新 Hook 定义的首次安全审查。
