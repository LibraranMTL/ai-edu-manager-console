# Windows 学生端 0.18.10 启动缺失模块修复

## 故障与根因

正式发布的 Windows 学生端 0.18.9 在启动时无法解析 `electron/project-mentor-actions.cjs`。对 0.18.9 发布 EXE 对应的 `app.asar` 清单检查确认：`companion-toolbar.cjs` 在包内，但被它静态导入的 `project-mentor-actions.cjs` 不在包内。构建源码中模块存在，Windows 学生端最小暂存文件列表漏复制该文件，打包后必需文件清单也未检查它。

对 0.18.9 暂存目录下所有 Electron `.cjs`、`.js` 和 `.mjs` 文件执行静态相对导入闭包扫描，只发现这一个缺失依赖。

## 修复

- 将 `electron/project-mentor-actions.cjs` 纳入 Windows 学生端最小运行时暂存和 ASAR 必需文件检查。
- 在构建过程中扫描 Electron 运行时中的静态相对 `require`、`import()` 和 `from` 引用，发现未暂存的本地依赖时终止构建，并将检查数量写入构建审计。
- 新补丁版本为 Windows 学生端 `0.18.10`（版本码 `240`）。下载页和版本清单保留当前线上 Windows 主机 `0.23.8`、Android 学生端 `0.6.33` 内容，仅更新 Windows 学生端版本和下载链接。

## 发布验证

构建必须通过相对运行时依赖闭包扫描，并确认最终 `app.asar` 包含 `electron/project-mentor-actions.cjs`、不含 `node_modules`，且未超过大小预算。构建、发布和设备验收状态以对应构建审计与交付记录为准。

## 构建与发布结果（2026-11-15）

- 构建源代码提交：`51b52b642597b55cb378d8c4e1940499c1e38c0f`；构建时工作树干净。
- 依赖审计：扫描 30 个 Electron 脚本中的 27 条静态相对导入，未发现缺失；最终 ASAR 共 173 个文件，包含项目导师动作模块，未包含 `node_modules`，大小 5,305,631 字节（构建上限 5,308,416 字节）。
- EXE：86,899,598 字节，SHA-256 `F6B9133149F65F0B56FADF5E8C1A31CF43127DC7EA006A02955D62FD0CAF56B1`。
- ZIP：86,907,199 字节，SHA-256 `6FDD56D54BD785163901837AA9A92E84A72D6E7C21D33B8455C62338B1D39774`。
- 已发布到 ECS `i-m5e6r68cl11nbh2y0o6z`（`cn-qingdao`）的 `/www/wwwroot/123.56.83.50/download/`，并更新 `/education/download.html`、Windows 学生手册、Android 学生手册及两处版本清单。Android 学生手册同步到线上已有的 `0.6.33/103`；发布页校验通过。
- 公网 HTTPS 对下载页、两份手册及两份清单均返回 `200`，小文件 SHA-256 与本地一致；EXE/ZIP 返回 `200`，Content-Length 与本地大小一致。旧 0.18.9 文件保留。
- 回滚备份：`/www/backup/windows-student-0.18.10-20261114-2358`；上传暂存目录已清理。
- 安装包未通过 Authenticode 签名检查（`NotSigned`）；未做真实设备安装验收。
