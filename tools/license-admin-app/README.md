# AI教育管家授权管理工具

这是内部 Windows 小应用，用于生成和管理 AI教育管家授权码。该工具不随客户版 Windows 主机控制台发布。

## 功能

- 生成授权码
- 自动保存发码记录
- 复制授权码
- 显示并保存 License v3 二维码，可供 Android 单机版扫码或从相册识别
- 搜索客户、联系方式、订单号、授权码和备注
- 修改记录状态：有效、已作废、已过期、已换码
- 导出 CSV
- 导出 JSON
- 打开本机记录目录

## License v3 与二维码

当前工具为 Windows 主机端和 Android 单机版签发设备绑定的 License v3：

```text
AIE3.<Base64URL 授权载荷>.<RSA-SHA256 签名>
```

生成后自动显示二维码，也可以从历史发码记录点击“二维码”。二维码仅编码完整原始 `AIE3...` 激活码；不上传到网络，不包含签发私钥。Android 单机版扫码后仍会校验产品、设备码、数字签名、有效期和学生席位。

## 本地运行

在项目根目录运行：

```powershell
pnpm license-admin:desktop
```

## 打包 Windows 版

在项目根目录运行：

```powershell
pnpm build:license-admin
```

输出位置：

```text
release\license-admin\AI-edu-license-admin-Windows-0.4.1.exe
```

## 记录文件

记录文件保存在当前 Windows 用户的应用数据目录，不保存在项目源码目录。

可在工具右上角点击“打开记录目录”查看。

## 安全注意

- 不要把该工具发给客户。
- 不要把授权记录文件提交到 Git。
- RSA 私钥只保存在受控授权管理电脑，不得复制到客户设备、源码或二维码中。
