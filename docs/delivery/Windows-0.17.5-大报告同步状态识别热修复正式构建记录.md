# Windows 主机端 0.17.5 大报告同步状态识别热修复正式构建记录

日期：2026-09-09
范围：Windows 主机端学情报告发布状态识别与学生知识档案同步反馈；Windows 学生端和 Android 各端不重打包。

## 问题与修复

- 赵书源的“每周行动建议”实际已有 `status: published`，但文件为 10,544 字节；旧逻辑尝试按“小文件”读取 8 KB，文件总大小超过上限时直接返回空文本，因而把已发布报告误判为未发布。
- 状态检查现改为直接读取文件头部前 8 KB，再解析 frontmatter；报告正文无论多长，都不会影响头部 `status` 的识别。
- “整体画像”当时为 4,933 字节，本身未触发该缺陷；检查到的 0.17.4 同步包已经包含整体画像、每周行动建议、历史变化和阶段总结四份报告。本次修复的是后续重复同步时显示的错误反馈。
- 保留同步前自动恢复发布、报告安全校验、学生一对一映射、原始资料排除、路径边界与 SHA-256 校验。

## 构建产物

| 产物 | 大小 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.17.5.exe` | 90,934,544 字节 | `E1DE84AE37587582812D9890976BED0D8EA3A9275D6602C19AF85824F9C2D12A` |
| `release/windows/AI-edu-manager-console-Windows-0.17.5.zip` | 90,942,728 字节 | `E2DD68633DDFFC71CDD7629F0466D7143164394B09CD6F0D0A3E1D5EFB67FDDF` |
| `release/windows/AI-edu-manager-console-Windows-0.17.5-build-audit.json` | 2,005 字节 | `F074C907F3B4C3D284A6931829C972DC27E3E7B45AEB7AAF4D09FF9421C7E14E` |

ZIP 只包含 0.17.5 正式 EXE；ZIP 内 EXE 的 SHA-256 与独立 EXE 完全一致。

## 包内审计

- 文件版本与产品版本：`0.17.5`；产品：`AI Education Manager Console`。
- 渲染资源：83 个文件、68 个资源文件，68 个全部可达。
- `app.asar`：11,736,773 字节、209 个文件、0 个 `node_modules` 文件。
- 成品 ASAR 反向检查确认主进程调用新的 `frontmatterValueFromFile(file, 'status', 8192)`，且不再包含旧的整文件 8 KB 拒绝读取调用。
- 源码、暂存运行时和打包产物三层敏感信息扫描均为 0 命中。
- Authenticode：`NotSigned`。

## 自动验证

- 学情报告、学生档案同步、协作传输、版本与交付文档专项回归：157/157 通过。
- 新增大文件回归用例：报告超过 8 KB 时仍能从文件头识别 `published`，通过。
- 赵书源真实 10,544 字节“每周行动建议”使用新读取器验证：返回 `published`。
- Windows 生产前端构建、Electron 打包、ZIP/EXE 一致性与版本信息复核通过。
- 全量仓库测试仍保留工作区既有 Android 单机版迁移和旧版显式草稿审核契约失败；这些不属于本次 Windows 热修复。

## 交付与验收边界

构建基线提交为 `35170a7169718c97693b65dca9b6dbfc1e003310`，构建时工作树为 `dirty=true`、共 130 个状态路径。本次完成本地正式构建，未安装启动、未上传网站、未推送 Git。0.17.4 已生成并排队的同步包不等于另一台电脑已经收到；检查时直传队列因目标不可达处于重试等待。由于 Authenticode 为 `NotSigned`，应仅在已知来源的受控设备上安装，并在两台电脑在线且可达时复测实际接收。
