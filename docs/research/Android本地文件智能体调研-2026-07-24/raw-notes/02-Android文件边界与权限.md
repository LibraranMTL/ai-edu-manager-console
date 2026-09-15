# Android 文件边界与权限

## Storage Access Framework

来源：https://developer.android.com/training/data-storage/shared/documents-files

Android 官方 SAF 允许用户通过系统选择器选定目录，应用获得该目录及子目录的 URI 读写权，而不是整台设备的文件访问权。`ACTION_OPEN_DOCUMENT_TREE` 与持久化 URI permission 很适合作为智能体工作区边界。Android 11+ 不能通过这一方式选择内部存储根、可靠 SD 卡根、Download 根、Android/data 或 Android/obb。应用应引导用户选择专用项目目录，并处理目录移动、删除或授权失效。

## 所有文件访问

来源：https://support.google.com/googleplay/android-developer/answer/10467955

`MANAGE_EXTERNAL_STORAGE` 受到 Google Play 严格限制，只适合文件管理、备份、杀毒、文档管理等核心用途，通常还需要声明和审核。一个教育智能体不应为了方便复制候选项目的所有文件访问设计。使用 SAF 可以让授权范围更可解释，也更容易满足最小权限和学生数据保护要求。

## 工具策略

文件工具必须接收相对路径或 document URI，不能接收任意绝对路径。所有 URI 要验证仍位于当前授权树。读取可以自动批准，写入要展示预览，覆盖和删除每次确认。删除优先移动到授权树内的软删除目录。发送远程模型前还要单独记录外发范围，不能把“已授权本地读取”等同于“已授权上传到模型”。
