# AI教育管家平板终端

这是独立于旧 Android 控制台 APK 的客户版平板终端，用于“Windows 主机控制台 + Android 平板终端”模式。

- 应用名称：AI教育管家平板终端
- 包名：com.qxmatrix.eduterminal
- 版本：0.3.14
- APK 文件名：AI-edu-manager-tablet-terminal-0.3.14.apk

## 客户版功能

- 拍照识别二维码或粘贴 Windows 主机配对信息，绑定设备 token。
- 读取主机端授权学生列表。
- 上传资料到主机。
- 浏览主机端学情 Markdown 档案。
- 从文件管理器、相册或其他 App 分享资料到平板终端后上传。

## 上传入口

“上传资料到主机”会提供多个入口：

- 选择文件：优先 ACTION_OPEN_DOCUMENT，失败后回退 ACTION_GET_CONTENT。
- 选择图片/截图：使用图片选择器或 image/* 内容选择器。
- 拍照上传：调用系统相机并直接上传拍照结果。
- 扫描 Downloads 最近文件：列出最近 50 个常见学习资料文件并支持多选上传。
- 上传已分享资料：接收其他 App 分享来的文件后上传。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File android-tablet-terminal\build.ps1
```

