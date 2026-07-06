# AI教育管家 iOS 平板终端

这是基于 Android 平板终端功能开发的 iOS 客户端源码，用于“Windows 主机控制台 + iPhone/iPad 终端”模式。

## 产品定位

- 应用名称：AI教育管家平板终端
- Bundle ID：`com.qxmatrix.eduterminal.ios`
- iOS 版本：`0.4.4`
- 面向对象：家长 / 学生
- 不包含：初始化教育管家、新建 Agent、QClaw / Hohu / OpenClaw 管理、Obsidian 设置、Windows 主机管理

## 已实现功能

- 扫码或粘贴 Windows 主机配对信息
- 保存主机地址、远程地址、设备 token 和连接模式
- 读取 Windows 主机授权学生列表
- 上传资料到主机
  - 文件选择
  - 图片/截图选择
  - 拍照上传
- 浏览主机端 Markdown 学情档案
  - 资料摘要
  - 综合汇总
  - 问答精华
  - 其他
  - 所有文档
- 网络失败时显示最近 Markdown 缓存
- 联系教育管家
  - 打开企业微信
  - 打开 QQ
  - 复制咨询提示
  - 复制消化提示
- 系统设置
  - 页面布局：自适应 / 平板横屏 / 手机竖屏
  - 五色皮肤
  - 淡化人物背景
  - 用户协议、隐私政策
  - iOS 版本检查
  - Tailscale 检测、打开和 App Store 下载

## macOS 构建方式

当前开发环境是 Windows，无法直接生成 iOS 可安装包。请在 macOS 上完成以下步骤：

```bash
cd ios-tablet-terminal
brew install xcodegen
xcodegen generate
open AIEduManagerTerminal.xcodeproj
```

在 Xcode 中：

1. 选择 Team / Signing 证书。
2. 连接 iPhone 或 iPad 真机。
3. 选择 `AIEduManagerTerminal` Target。
4. 点击 Run 进行真机测试。
5. 需要发布时使用 Archive 生成 TestFlight 或 App Store 包。

## 注意事项

- iOS 不允许像 Android APK 一样直接安装未签名包，必须使用 Apple Developer 账号签名。
- iOS 的“是否安装 Tailscale”通过 `tailscale://` URL Scheme 检测，若系统限制或 Tailscale 未暴露 Scheme，可能只能打开 App Store 下载页。
- 企业微信和 QQ 的精确联系人唤起依赖第三方 App URL Scheme 能力，当前先实现“打开 App + 复制提示词”。
- 局域网 HTTP 访问已在 `Info.plist` 中允许；正式上架前如启用公网服务，建议改用 HTTPS。

## 与 Android 平板终端的差异

- Android 使用原生 Java APK；iOS 使用 SwiftUI。
- Android 可扫描 Downloads 最近文件；iOS 受沙盒限制，改用系统文件选择器和照片选择器。
- iOS 更新检查会读取 `edu-manager-version.json` 中的 `iosVersionCode` / `iosUrl` 字段。
