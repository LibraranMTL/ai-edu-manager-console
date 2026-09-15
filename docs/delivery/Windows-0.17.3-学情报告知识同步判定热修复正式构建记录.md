# Windows 主机端 0.17.3 学情报告知识同步判定热修复正式构建记录

日期：2026-09-08
范围：Windows 主机端知识协作中的学生学情报告同步判定热修复；Windows 学生端和 Android 各端不重打包。

## 修复内容

- 正式学情报告同步状态由仅识别 `published` 扩展为兼容 `published`、`current`、`updated`、`active`，避免旧版正式报告未进入同步内容指纹。
- `generated`、`draft`、`pending_review`、`rejected` 及缺少正式状态的报告继续留在本机，不进入跨主机档案包。
- 点击“立即同步”且只有未校验报告发生变化时，结果会明确列出未通过自动校验发布的报告，并说明其余档案无实质变化，不再给出误导性的笼统提示。
- 保留一对一学生映射、原始资料排除、远端来源抑制、路径边界校验、版本谱系和 SHA-256 校验。

## 构建产物

| 产物 | 大小 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.17.3.exe` | 90,932,728 字节 | `A46DFD3B6CB5A0305869FB76D2BA5E941539DDA10091D3A5FC5C65D35967E4B7` |
| `release/windows/AI-edu-manager-console-Windows-0.17.3.zip` | 90,940,714 字节 | `9AB64245A632678178B0A1B3FE375B795F3F42648B24EC1902C60A613205486A` |
| `release/windows/AI-edu-manager-console-Windows-0.17.3-build-audit.json` | 2,005 字节 | `BC4A5567F1C32104C38EB38468B1464BC0FA613EB60B34F0E8D55176C1DB18D7` |

ZIP 只包含正式 EXE；ZIP 内 EXE 的 SHA-256 与独立 EXE 完全一致。

## 包内审计

- 文件版本与产品版本：`0.17.3`；公司：`Robogala`；产品：`AI Education Manager Console`。
- 渲染资源：83 个文件、68 个资源文件，68 个全部可达。
- `app.asar`：11,734,350 字节、209 个文件、0 个 `node_modules` 文件。
- 包内确认包含正式报告状态兼容策略、未校验报告明确提示，以及 0.17.2 的 `pathInside` 导入修复。
- 主进程、预加载脚本和课程导入运行时语法检查通过；源码、暂存运行时和打包产物三层敏感信息扫描均为 0 命中。
- Authenticode：`NotSigned`。

## 自动验证

- 版本、报告状态和知识同步核心测试：19/19 通过。
- 协作同步范围回归：57/57 通过。
- Windows 发布范围回归：913 通过、1 项按环境条件跳过、0 失败。
- 全量仓库测试：937 项，其中 932 通过、1 项跳过、4 项失败；失败均来自工作区既有 Android 单机版候选迁移和旧版报告草稿契约，不属于本次 Windows 热修复。
- 成品反向检查确认版本为 0.17.3，ZIP 内 EXE 与独立 EXE 哈希一致。

## 发布边界

构建基线提交为 `35170a7169718c97693b65dca9b6dbfc1e003310`，构建时工作树为 `dirty=true`、共 125 个状态路径。本次只完成本地正式构建，未安装启动、未上传网站、未推送 Git。由于 Authenticode 为 `NotSigned`，应仅在已知来源的受控设备上安装；真实跨主机验收仍需参与同步的两台 Windows 主机都升级到 0.17.3 后执行。
