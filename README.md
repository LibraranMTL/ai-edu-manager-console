# AI Education Manager · AI教育管家

AI教育管家帮助家庭和教育工作者组织学生资料、跟踪学习过程并管理项目知识。Windows 主机连接学生端和教师端，Android 单机版支持在移动设备上独立使用。系统结合授权范围内的资料与 AI Agent，辅助整理、检索和生成学习成果。

## 主要功能

- 学生资料与档案管理，按学生和项目组织学习记录、原始资料和证据。
- 智能资料收件箱，采集已授权来源的资料，分析项目归属，自动投递并保留处理回执。
- 学情与成长记录，整理学习事件、报告、成长模型及教育档案。
- 项目与知识管理，归集项目资料、研究过程和阶段成果，支持检索与协作。
- 学习与课程支持，提供学习卡片、精选课程和专注模式。
- 多端协同，Windows 学生端、Android 学生端及 Android 教师端连接 Windows 主机。
- Android 单机版，支持在 Android 设备上管理学生资料和学习成果。
- 激活与恢复，支持联网自助激活及原有设备码授权方式。

## Overview

AI Education Manager helps families and educators organize student materials, follow learning progress, and manage project knowledge. A Windows host works with student and teacher clients, while the Android standalone edition supports independent use on a mobile device. Authorized materials and AI agents assist with organizing, retrieval, and creating learning outputs.

## Features

- Organize student profiles, learning records, original materials, and evidence by student and project.
- Collect materials from authorized sources in a smart inbox, assess project ownership, deliver eligible items automatically, and retain receipts.
- Maintain learning records, reports, growth models, and education portfolios.
- Manage project materials, research, milestones, knowledge retrieval, and collaboration.
- Support learning cards, selected courses, and focus mode.
- Connect Windows and Android student clients and the Android teacher client to a Windows host.
- Use the Android standalone edition to manage student materials and learning outputs on one device.
- Activate online with a code or use the existing device-code licensing method.

## 下载 · Downloads

[AI教育管家下载页面 / AI Education Manager downloads](https://www.greatbg.com/education/download.html)

## 开发与维护 · Development and maintenance

Bao Xiaowen · Shuyuan Bao · Shu Yuan Robert Zhao · Shuyang Bao · Lily Zhao

版本历史与发布规则见 [CHANGELOG.md](CHANGELOG.md)。

## 本地运行

```powershell
pnpm install
pnpm dev
```

## 构建

```powershell
pnpm build
```

## Android 打包路线

Android 教师端使用仓库内的独立原生构建路线：

```powershell
powershell -ExecutionPolicy Bypass -File android-teacher-terminal\build.ps1
```

以下 Capacitor 路线仅用于早期 Android Web/PWA 原型，不是当前教师终端 APK 的构建方式。

当前工程已预置 Capacitor 配置。安装 Android Studio / Android SDK 后执行：

```powershell
pnpm add @capacitor/core @capacitor/cli @capacitor/android
pnpm build
npx cap add android
npx cap sync android
```

然后用 Android Studio 打开 `android/` 目录打包 APK。

## Android 文件能力说明

浏览器/PWA 不能直接静默创建任意公共目录。真正 APK 版本建议接入 Capacitor Filesystem 或自定义 Android 原生插件，用于：

- 在用户授权后创建 `Documents/学生资料/{学生名}知识库`
- 写入 `AGENT.md`、`Soul.md`、`Memory.md`
- 调用外部 App：QClaw、Obsidian
- 记录初始化状态

第一版 Web/PWA 原型先提供“下载初始化包”和“复制 QClaw 指令”，用于验证销售和交付流程。

## 0.4.5 Windows 主机控制台发布说明

- Windows 主机控制台版本：`0.4.5`，发布物：`release/windows/AI-edu-manager-console-Windows-0.4.5.exe`。
- Android 平板终端版本保持：`0.4.3`，发布物：`release/tablet-terminal/AI-edu-manager-tablet-terminal-0.4.3.apk`。
- 新增“接管已有知识库 + 绑定已有 Agent 工具”：可登记既有 QClaw、Hohu、Marvis、OpenClaw 学生知识库，不移动、不复制、不删除旧文件。
- Agent 工具新增 OpenClaw，补齐安装检测、打开状态、打开按钮、下载入口和初始化提示。
- 上传资料、档案浏览、消化指令、Soul 工作规则统一使用学生记录中的真实知识库路径。

### 0.4.5 更新清单建议字段

```json
{
  "versionCode": 55,
  "versionName": "0.4.5",
  "windowsVersionCode": 55,
  "windowsVersionName": "0.4.5",
  "windowsUrl": "https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.4.5.exe",
  "tabletTerminalVersionCode": 53,
  "tabletTerminalVersionName": "0.4.3",
  "tabletTerminalApkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.4.3.apk",
  "apkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.4.3.apk",
  "notes": "Windows 0.4.5：新增接管已有知识库与绑定已有 Agent 工具能力，支持标准知识库和接管知识库并存；Agent 工具新增 OpenClaw，并同步安装检测、打开状态、初始化指令、Soul 工作规则和资料路径。平板终端 0.4.3 保持不变。"
}
```

## 0.4.0 双端收敛说明

- Windows 主机控制台版本：`0.4.0`，发布物：`release/windows/AI-edu-manager-console-Windows-0.4.0.exe`。
- Android 平板终端版本：`0.4.0`，发布物：`release/tablet-terminal/AI-edu-manager-tablet-terminal-0.4.0.apk`。
- Windows 默认学生根目录：`D:\学生资料`。
- 平板终端只保留客户功能：连接主机、上传资料到主机、查看学情档案、联系教育管家、连接状态与系统设置。
- Windows 主机端保留管理员功能：学生初始化、QClaw 辅助、主机服务、扫码配对、设备授权、上传记录、备份恢复、安全诊断。

### 0.4.0 新增交付能力

- 主机数据备份与恢复：导出/恢复学生索引、设备授权、上传记录和主机事件。
- 主机上传状态闭环：上传记录可标记为“待消化 / 已提交消化 / 已处理完成”。
- 安全与诊断：上传文件类型和大小限制、API Token 重置、诊断日志导出。
- 首次使用清单：Windows 首页显示创建学生、启动服务、绑定平板、上传资料的完成状态。
- 平板终端更新与诊断：支持检查更新、复制诊断信息给售后排查。

### 更新清单建议字段

```json
{
  "versionCode": 50,
  "versionName": "0.4.0",
  "windowsVersionCode": 50,
  "windowsUrl": "https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.4.0.exe",
  "tabletTerminalVersionCode": 50,
  "tabletTerminalVersionName": "0.4.0",
  "tabletTerminalUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.4.0.apk",
  "apkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.4.0.apk",
  "notes": "0.4.0：双端交付稳定性增强，包含备份恢复、上传状态闭环、诊断日志和平板终端更新检查。"
}
```
