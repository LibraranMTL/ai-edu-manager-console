# Windows 0.15.2 精选课程二级菜单与授权审计

日期：2026-07-30
状态：受控候选；功能、自动测试、界面渲染和生产打包完成，公开发布仍待 Authenticode 等外部门禁。

## 1. 本次更新

- Windows 主机端“精选课程”作为一级折叠菜单，下设“课程学习”和“课程管理”。
- “课程学习”向所有版本开放，只显示机构已经启用、且分配给当前学生的课程。
- “课程管理”只允许许可证有效且版本为专业版 `PRO` 或机构版 `ORG` 的用户打开。
- 家庭版、试用版、未激活或过期授权显示锁定状态；在课程管理页期间发生许可证降级或失效时，界面自动返回课程学习。
- 课程导入、Excel 模板导出、Excel 导入、机构课程策略保存均由 Electron 主进程再次执行 PRO/ORG 校验，不能通过直接调用 IPC 绕过。

## 2. 自动与界面验收

| 检查 | 结果 |
| --- | --- |
| 全量自动测试 | `568/568` 通过 |
| Windows 主机生产构建 | 通过 |
| Windows 学生端生产构建 | 通过 |
| 主机包内静态资源 | `68/68` 可达，`0` 个不可达 |
| 主机包内运行依赖 | `0` 个散落 `node_modules` |
| 学生端包内运行依赖 | `0` 个散落 `node_modules` |
| 浏览器渲染检查 | 课程学习、课程管理页面均可打开，控制台无错误或警告 |
| Windows 最小主机窗口检查 | `980 × 820` 下两个二级菜单均可见，无框架遮挡 |

浏览器验收截图保存在本机 Codex 可视化目录：

- `course-menu-qa/course-learning.png`
- `course-menu-qa/course-management.png`
- `course-menu-qa/course-menu-min-host.png`

## 3. 交付文件

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `release/windows/AI-edu-manager-console-Windows-0.15.2.exe` | 90,817,662 | `B62E239AEC66464F5DE1C223F64998A4921E9F112958FE99B44E12FA2F22E552` |
| `release/windows/AI-edu-manager-console-Windows-0.15.2.zip` | 90,826,145 | `3B97A58051D998AFBDC41EF480A823F3614B5EE3904FAF4B6E3347F0999A0E23` |
| `release/windows-terminal/AI-edu-manager-student-terminal-Windows-0.15.2.exe` | 85,535,465 | `455A77F8331348C6FA672AABDF18CC4F4A3D7B7F961F2B2B3BD41604360BCFB6` |

两个 Windows EXE 的 `ProductVersion` 与 `FileVersion` 均为 `0.15.2`，公司为 `Robogala`；Authenticode 状态均为 `NotSigned`。

## 4. 发布边界

- 本次只调整 Windows 主机端课程导航与授权入口，Android 学生端保持 `0.6.9`。
- 已完成的浏览器渲染检查不替代家庭版、试用版、专业版、机构版四种真实许可证的安装包真机切换复测。
- Windows 安装包尚未使用正式 Authenticode 证书签名，因此只能受控分发。

## 5. 文档与网站同步

- Windows 主机端 Markdown、PDF 与网页手册均补充课程学习、课程管理、Excel 自选课程、平台离线签名目录和常见错误说明。
- Windows 与 Android 学生端 Markdown、PDF 与网页手册均明确：学生端没有课程管理菜单，只显示当前学生获分配的课程。
- 网站下载页增加 Windows `0.15.2` 课程菜单更新区，并继续链接主机端 `0.15.2`、Windows 学生端 `0.15.2` 与 Android `0.6.9` 文件。
- PDF 文字抽取与课程章节页面渲染检查通过；下载页和主机网页手册在桌面及 `390 × 844` 移动视口检查通过。
