# Windows 主机端 0.17.2 跨主机同步热修复正式构建记录

日期：2026-09-08
范围：Windows 主机端跨主机学生档案同步热修复；Windows 学生端和 Android 各端不重打包。

## 修复内容

- 原因：主进程在协作直传包路径校验中调用 `pathInside()`，但未从 `collaboration-sync.cjs` 导入该函数，点击“立即同步”时触发 `ReferenceError`。
- 修复：补齐受控路径校验函数导入；保留一对一学生映射、同步范围限制、路径越界拦截和 SHA-256 校验。
- 回归约束：增加主进程必须显式导入 `pathInside` 的契约测试，防止后续打包再次遗漏。
- 部署要求：参与跨主机学生档案同步的两台 Windows 主机均升级到 0.17.2 后再复测。

## 构建产物

| 产物 | 大小 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.17.2.exe` | 90,933,461 字节 | `286F86B2AB80709BA1DD681A91EB4612855439A94D089E88F2265EE0447F9CF7` |
| `release/windows/AI-edu-manager-console-Windows-0.17.2.zip` | 90,941,216 字节 | `E608C5B8F751B333CB2391BA41BE4B686FC33A72AD36671054540BB3017852BD` |
| `release/windows/AI-edu-manager-console-Windows-0.17.2-build-audit.json` | 2,005 字节 | `46C7F7C1EC88A545686BC0F84D24574A98FB7C40AD1876E8D574F198E33024A3` |

ZIP 只包含正式 EXE；包内 EXE 的大小和 SHA-256 与独立 EXE 完全一致。

## 包内审计

- 文件版本与产品版本：`0.17.2`；公司：`Robogala`；产品：`AI Education Manager Console`。
- 渲染资源：83 个文件、68 个资源文件，68 个全部可达。
- `app.asar`：11,733,066 字节、209 个文件、0 个 `node_modules` 文件。
- 包内主进程确认包含 `pathInside` 导入，主进程、预加载脚本和课程导入运行时语法检查通过。
- 源码、暂存运行时和打包产物三层敏感信息扫描均为 0 命中。
- Authenticode：`NotSigned`。

## 自动验证

- 热修复及核心知识协作测试：38/38 通过。
- Windows 发布范围回归：911 通过、1 项按环境条件跳过、0 失败。
- 全量仓库测试：935 项，其中 930 通过、1 项跳过、4 项失败；失败均为工作区既有 Android 单机版候选迁移与旧版报告草稿契约，不属于本次 Windows 热修复。
- ZIP 内 EXE SHA-256 与独立 EXE 一致。

## 本机安装验证

- 已正常关闭从 `release/windows/AI-edu-manager-console-Windows-0.17.1.exe` 启动的旧版进程。
- 已从 `release/windows/AI-edu-manager-console-Windows-0.17.2.exe` 启动新版；便携版主进程及渲染进程均正常运行。
- 已创建桌面快捷方式 `AI教育管家控制台.lnk`，目标为本次 0.17.2 正式 EXE。
- 新版继续使用既有 `edu-manager-launcher` 用户数据目录，未迁移、删除或重置学生与协作数据。

## 发布边界

构建基线提交为 `35170a7169718c97693b65dca9b6dbfc1e003310`，构建时工作树为 `dirty=true`、共 122 个状态路径。本次只完成本地正式构建与本机启动安装，尚未上传网站，也未推送 0.17.2 Git 提交。由于 Authenticode 为 `NotSigned`，应仅在已知来源的受控设备上安装，并在两台主机均升级后完成一次真实跨主机同步验收。
