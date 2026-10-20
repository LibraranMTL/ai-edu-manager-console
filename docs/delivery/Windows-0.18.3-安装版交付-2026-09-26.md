# Windows 主机 0.18.3 安装版交付

用户于 2026-09-26 明确反馈「已经测试，运行效果改善」，并要求生成正式安装版本。

本次仅封装 Windows 主机安装向导，应用版本保持 0.18.3。直接从已测便携 EXE 解出运行时并使用 NSIS 封装，未从当前工作树重新编译应用。保留用户既有改动；未修改 Android/学生端或云端部署。

## 本地交付

`release/windows/installer-0.18.3/AI-edu-manager-console-Windows-0.18.3-Setup.exe`

详见同目录「安装说明.md」。33 个运行时文件与已测版本哈希一致。EXE ProductVersion/FileVersion 均为 0.18.3，CompanyName 为 Robogala，签名状态 NotSigned。安装包 SHA-256：`0FD006697701471F3F3D8401FA6B54DA80B9F52ED221C772FDC5F107DA03A7E2`。

## 打包与核验入口

```powershell
node scripts/build-windows-installer.cjs release/windows/candidates/performance-20260926/AI-edu-manager-console-Windows-0.18.3-performance-20260926-build-audit.json
node scripts/verify-windows-installer.cjs release/windows/installer-0.18.3/installer-audit.json
```

打包脚本校验来源 EXE 大小与 SHA-256，拒绝覆盖已有安装版交付目录，保留 appId、包名及 Robogala 元数据；安装向导默认当前用户、固定程序目录、创建桌面和开始菜单快捷方式、不自动启动、不删除用户数据。核验脚本分别解包来源便携版与安装版，逐文件对比，不执行安装器。

配置依据：[electron-builder NSIS 官方说明](https://www.electron.build/nsis/)及本地安装的 26.15.3 类型定义、安装/卸载模板。单项配置测试与全量回归通过：1107 passed、0 failed、1 skipped。

## 未完成的发布门槛

- 未配置 Windows 代码签名，因此不能宣称是受信任发行者签名的公开发行包。
- 未在开发机执行安装/升级/卸载，避免覆盖运行实例和写入正式卸载注册表；需按安装说明进行实际安装验收。
- 官网/ECS/在线版本清单未修改。原本地更新清单的 candidate 字段继续保留，直到线上发布信息同步，不能据此宣称官网已发布。
- 原应用的云端跨设备验收仍延期；本次用户反馈仅确认运行效果改善。
