# AI教育管家授权管理工具

这是内部 Windows 小应用，用于生成和管理 AI教育管家授权码。该工具不随客户版 Windows 主机控制台发布。

## 功能

- 生成授权码
- 自动保存发码记录
- 复制授权码
- 搜索客户、联系方式、订单号、授权码和备注
- 修改记录状态：有效、已作废、已过期、已换码
- 导出 CSV
- 导出 JSON
- 打开本机记录目录

## 授权码格式

当前授权码格式与 Windows 主机控制台 0.6.1 兼容：

```text
AIE-套餐-到期日-学生数-设备数-随机码-签名
```

例如：

```text
AIE-FAMILY-PERM-3-3-XXXXXXXXXX-XXXXXXXXXXXX
```

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
release\license-admin\AI-edu-license-admin-Windows-0.1.0.exe
```

## 记录文件

记录文件保存在当前 Windows 用户的应用数据目录，不保存在项目源码目录。

可在工具右上角点击“打开记录目录”查看。

## 安全注意

- 不要把该工具发给客户。
- 不要把授权记录文件提交到 Git。
- 如后续升级为公私钥模式，应由该工具保存私钥，客户 Windows 主机端只内置公钥。
