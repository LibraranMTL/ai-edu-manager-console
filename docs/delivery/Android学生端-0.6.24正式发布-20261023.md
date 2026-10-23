# Android 学生端 0.6.24 正式发布记录

- 发布日期：2026-10-23
- 版本：`0.6.24`（versionCode `94`）
- 安装包：`AI-edu-manager-tablet-terminal-0.6.24.apk`
- 大小：`1,893,352` 字节
- SHA-256：`6F1184BD572F7FF0AEFFA0F4FBC85149A1832FF07AB2DC9C6460E046765676C3`
- 签名：APK Signature Scheme v1/v2/v3 均通过
- 签名主体：`CN=AI Education Tablet Terminal, O=QXMatrix, C=CN`
- 证书 SHA-256：`42FF27472C21FD214C17A9DFB153DA0454489D4E2AD70CE823F3369118A5F1CB`

## 发布内容

- 首页统一为“搜集上传、主机连接、教育档案、学习行动”四个核心入口。
- 文件和图片支持多选；资料确认学生及目标后直接进入持久上传队列，资料箱仅保留为离线与失败恢复机制。
- “导入对话”支持粘贴文字、导入文本文件和公开 HTTPS 链接预览。
- 个人终端首次绑定支持学生 ID 或二维码，共享终端保持逐次登录和退出清理。
- 教育档案按只读边界展示学情报告、成长模型、学情档案、项目资料和规划指导。
- 学习卡片作答新增拍照、图片和文件附件；图片可由匹配主机继续执行 OCR、视觉理解和一致性核对。

## 验证

- 华为 NAM-AL00 真机覆盖安装成功，已核对版本 0.6.24、学生自动登录和四个一级入口。
- 已验证学习卡片的拍照、系统图片选择器和文件选择器均可启动；未提交真实学生练习。
- Android 专项合同测试通过。
- 全量测试共 2493 项：2490 通过、1 跳过、2 失败。两项失败均来自并行 Windows 0.21.6 发布材料不一致：正式清单仍为 0.21.2，且本地缺少页面所指的 0.21.6 ZIP；未纳入本次 Android 发布。
- 下载页和手册已在 1440×1000 与 390×844 下检查，无水平溢出；公网手机视口资源加载完整且控制台无错误。

## 阿里云发布证据

- APK：<https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.6.24.apk>
- 下载页：<https://www.greatbg.com/education/download.html>
- 操作手册：<https://www.greatbg.com/education/android-student-manual.html>
- 两份更新清单均发布 Android 0.6.24 / code 94，同时保持 Windows 正式版为 0.21.2。
- 公网下载 APK 为 1,893,352 字节，SHA-256 与本地正式包一致。
- 服务器回滚备份：`/www/backup/android-student-0.6.24-20261023-164109`
- 发布暂存目录在完成公网验证后已删除。

## 边界

- 本次仅发布 Android 学生端，不发布或替换 Windows 0.21.6。
- 旧版 Android 学生端 APK 未删除，便于必要时人工回退。
- 学习卡片附件的 OCR／视觉理解依赖主机能力；旧主机缺少能力时客户端应提示更新主机端。
