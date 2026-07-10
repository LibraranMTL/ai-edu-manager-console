# AI教育管家命令行授权工具

该目录保留为内部命令行备用工具。日常发码请优先使用带界面的独立应用：

```text
tools/license-admin-app
```

客户版 Windows 主机控制台不包含授权码生成、发码记录或导出记录功能。

## 生成授权码

```powershell
node tools/license-admin/license-admin.cjs issue --customer "张三家庭" --contact "微信号" --plan FAMILY --expires 2027-12-31 --students 3 --devices 3 --note "订单备注"
```

命令会输出授权码，并写入：

```text
tools/license-admin/license-records.json
```

## 查看与导出

```powershell
node tools/license-admin/license-admin.cjs list
node tools/license-admin/license-admin.cjs export
```

## 发布注意

不要把本目录或 `tools/license-admin-app` 作为客户交付物发布。客户只接收 Windows 主机控制台和平板终端。
