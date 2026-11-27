# AI教育管家

[English](README.md) | **简体中文**

AI教育管家帮助家庭、学生和教育工作者收集学习资料、维护学生档案并管理项目知识。Windows 主机连接学生端和教师端，Android 单机版可在手机或平板上独立运行。用户可连接受支持的 AI Agent，辅助整理和分析已授权资料。

[官网入口](https://education.robogala.com) · [中文下载页](https://www.greatbg.com/education/download.html) · [English downloads](https://www.greatbg.com/education/download-en.html) · [版本清单](https://www.greatbg.com/download/edu-manager-version.json) · [发布记录](https://github.com/LibraranMTL/ai-edu-manager-console/releases)

## 当前正式版本

| 版本 | 最新正式版 | 用途 |
| --- | --- | --- |
| Windows 主机 | **0.24.5** | 管理学生、资料、项目、Agent、报告和连接的终端 |
| Windows 学生端 | **0.19.3** | 连接主机采集资料并使用学生工作台 |
| Android 学生端 | **0.6.34** | 上传、分享学习资料并查看主机提供的内容 |
| Android 教师端 | **0.1.5** | 选择学生和项目，采集资料并查看主机记录 |
| Android 单机版 | **1.3.9** | 在 Android 手机或平板独立管理学生知识空间 |

各端版本独立更新。下载中心提供当前安装包及可用的旧版回退包。Windows 程序尚未签名，请核对下载来源和版本清单中的校验值。

## 主要功能

### 学生档案与学习

- 新建或接管学生档案，按学生整理原始资料、学习事件、学习资源、知识点、成长模型及报告，并保留依据。
- 使用学习卡片、学习行动和精选课程，查看已发布教育档案。Windows 专注模式支持配置应用和网页规则。
- 生成并导出受支持的报告和教育内容，用于复核与沟通。

### 资料采集与智能收件箱

- 导入文件，采集照片、屏幕、录音及 AI 对话。会话自动采集在用户配置的授权范围内执行。
- 接入资料来源，系统核验学生及项目范围，复用已核验分类结果，对符合条件的资料自动投递并保留回执。归属不明确时可集中查看和判断。
- 自动续接可恢复的提取、分类和投递核验。确认无业务内容的内部任务和真实空资料可按设置回收，保留用户原件和有效证据。

### 项目、知识与 Agent

- 管理项目资料、知识、里程碑、选题和研究，关联学生并查看项目报告和成果。
- 通过主机的受控接口连接 WorkBuddy、Codex 等支持的 Agent。安装、登录授权和自动派发资格分别检查。
- 在可信节点间按授权范围进行知识协作，在分享或发布前核对范围。

### 多端协同与独立使用

- 学生端和教师端与 Windows 主机配对。学生按配置范围访问，教师采集时选择学生与授权项目。
- Android 单机版提供本地资料采集、OCR、精选课程、学生档案、项目、备份和联网自助激活。

## 安装与首次使用

### Windows 主机

1. 从[中文下载页](https://www.greatbg.com/education/download.html)下载 Windows 主机安装版，也可选择便携 EXE 或 ZIP。升级前退出旧版并备份状态。
2. 运行安装包并启动 AI教育管家。Windows 程序尚未进行 Authenticode 签名，安装前请核对官网来源与[版本清单](https://www.greatbg.com/download/edu-manager-version.json)中的文件哈希。
3. 在“系统设置 → 基础设置 → 许可证授权”输入购买的激活码，联网激活。原设备码授权和许可证文件导入继续可用，同一设备可恢复已有激活。
4. 新建或接管学生档案并选择资料位置。如需 Agent 辅助处理，配置并授权受支持的 Agent。
5. 在资料收件箱添加已授权来源，核对来源和学生范围后按需启用自动处理。通过任务和收件箱查看进度、回执及待判断事项。

[Windows 主机使用手册](https://www.greatbg.com/education/windows-host-manual.html)

### 学生端与教师端

1. 从下载中心安装 Windows 学生端、Android 学生端或 Android 教师端。
2. 启动 Windows 主机及其终端服务，按对应手册完成设备配对。
3. 学生端先建立正确的学生会话，再上传或查看资料。教师端采集时选择学生和已授权项目。

[Windows 学生端手册](https://www.greatbg.com/education/windows-student-manual.html) · [Android 学生端手册](https://www.greatbg.com/education/android-student-manual.html) · [Android 教师端手册](https://www.greatbg.com/education/android-teacher-manual.html)

### Android 单机版

1. 下载并安装正式签名 APK。升级前制作加密备份，使用相同证书签名的正式版可覆盖升级。
2. 首次启动时联网输入或扫描购买的激活码，也可继续使用原设备码授权。
3. 选择并授权长期保留的本机目录，创建或接管学生档案，并按需配置受支持的 Agent。

[Android 单机版手册](https://www.greatbg.com/education/android-standalone-manual.html)

## 开发

Windows 主机基于 Electron 与 Vite。在仓库根目录执行 `pnpm install` 和 `pnpm dev`。Windows 检查可运行 `pnpm typecheck` 和 `pnpm test:windows`。正式发布与各平台打包需完成对应的构建及验收。历史变更见 [CHANGELOG.md](CHANGELOG.md)。

## 开发与维护

Bao Xiaowen · Shuyuan Bao · Shu Yuan Robert Zhao · Shuyang Bao · Lily Zhao
