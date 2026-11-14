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
