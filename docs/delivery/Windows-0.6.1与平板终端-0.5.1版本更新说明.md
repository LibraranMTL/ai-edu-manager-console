# AI教育管家 Windows 0.6.1 与平板终端 0.5.1 版本更新说明

发布日期：2026-07-09  
发布类型：交付修正版 / 稳定性增强版  
适用端：

- Windows 主机控制台：0.6.1
- AI教育管家平板终端：0.5.1
- 旧 Android 控制台：0.2.3，仅内部装机和测试使用

## 发布文件

Windows 主机控制台：

```text
AI-edu-manager-console-Windows-0.6.1.zip
```

平板终端：

```text
AI-edu-manager-tablet-terminal-0.5.1.apk
```

更新清单：

```text
edu-manager-version.json
```

正式下载清单地址：

```text
https://www.greatbg.com/download/edu-manager-version.json
```

## 更新摘要

- Windows 客户版剥离授权码生成、发码记录和导出记录管理，只保留许可证激活与状态校验。
- 授权码生成改为内部“AI教育管家授权管理工具”，不随客户 Windows 包发布。
- 修复 Windows 教育档案 Markdown 表格渲染异常，支持带外侧竖线和不带外侧竖线的常见表格格式。
- 平板终端 0.5.1 增加上传、待消化、已消化和档案状态显示。
- 继续保持 Windows 主机控制台 + 平板终端的双端架构，客户平板端不暴露管理员功能。

## Windows 0.6.1 主要变化

### 许可证授权收口

客户 Windows 主机端只保留：

- 输入授权码激活
- 查看授权状态
- 刷新授权状态
- 移除本机许可证

已移除客户界面的：

- 生成授权码
- 刷新发码记录
- 导出发码记录
- 授权记录管理

内部发码工具位置：

```text
tools/license-admin/license-admin.cjs
```

该工具仅供内部人员使用，不应随客户安装包发布。

### Markdown 表格修复

Windows 教育档案内置 Markdown 阅读器修复表格识别逻辑。以下两种格式均可显示：

```md
| 科目 | 表现 |
| --- | --- |
| 数学 | 稳定 |
```

```md
科目 | 表现
--- | ---
数学 | 稳定
```

### 打包安全检查

Windows 0.6.1 打包白名单仍只包含：

- `dist/**/*`
- `electron/**/*`
- `package.json`

内部授权管理工具和授权记录文件不会被打入客户包。

## 平板终端 0.5.1 主要变化

- 首页和上传模块显示上传资料到主机的状态。
- 学生卡片和档案区域显示待消化、已消化和档案状态。
- 保持客户终端定位，只提供连接主机、上传资料、查看学情档案、联系教育管家、连接状态和系统设置。
- 不显示初始化、新建 Agent、QClaw/Obsidian 目录配置等管理员功能。

## 兼容性说明

Windows：

- 兼容已有标准学生记录。
- 兼容接管已有知识库的学生记录。
- 兼容 QClaw、Hohu、Marvis、OpenClaw 工具配置。
- 主机服务和设备 token 保持原有逻辑。

平板终端：

- 0.5.1 可连接 Windows 0.6.1。
- 已绑定设备正常情况下不需要重新扫码。
- 如果 Windows 端撤销设备或重置访问范围，需要重新绑定或重新授权学生。

## 升级建议

建议所有已部署 Windows 主机控制台的客户升级到 0.6.1，尤其适合：

- 准备商业交付，需要避免客户看到授权发码管理入口。
- 教育档案中包含 Markdown 表格。
- 已使用平板终端上传资料并需要查看消化状态。

升级前建议：

- 备份主机数据。
- 另行备份完整学生资料目录，例如 `D:\学生资料`。
- 关闭旧版 Windows 主机控制台。
- 解压新版 zip 并启动新版 exe。

## 回归测试记录

已执行：

- `pnpm build`
- `pnpm build:win`
- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`
- `node --check tools/license-admin/license-admin.cjs`
- 检查客户包资源中不包含 `license-admin` 或授权记录文件

最终发布物：

```text
release\windows\AI-edu-manager-console-Windows-0.6.1.exe
release\windows\AI-edu-manager-console-Windows-0.6.1.zip
release\tablet-terminal\AI-edu-manager-tablet-terminal-0.5.1.apk
```

## edu-manager-version.json

```json
{
  "versionCode": 61,
  "versionName": "0.5.1",
  "windowsVersionCode": 71,
  "windowsVersionName": "0.6.1",
  "windowsUrl": "https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.6.1.zip",
  "terminalApkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.5.1.apk",
  "tabletTerminalVersionCode": 61,
  "tabletTerminalVersionName": "0.5.1",
  "tabletTerminalApkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.5.1.apk",
  "managerApkUrl": "https://www.greatbg.com/download/edu-manager-android-0.2.3.apk",
  "managerApkVersionCode": 23,
  "managerApkVersionName": "0.2.3",
  "apkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.5.1.apk",
  "notes": "Windows 0.6.1：客户版剥离授权码生成与记录管理，只保留许可证激活校验；修复 Windows 教育档案 Markdown 表格渲染。平板终端 0.5.1：增加上传、待消化、已消化和档案状态显示。"
}
```

---

嘉玛蓝（北京）科技有限公司版权所有
