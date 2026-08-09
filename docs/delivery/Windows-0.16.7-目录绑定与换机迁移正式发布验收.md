# Windows 0.16.7 目录绑定与换机迁移正式发布验收

## 发布结论

Windows 主机端 `0.16.7` 的最新候选包 `path-rebind-two-buttons-v7` 已完成真机验证：分别更改学生原始资料库和学生知识库路径后，重新创建并恢复迁移包成功。该候选包现晋升为受控正式版本。

正式 EXE 直接复制自已验收候选 EXE，未重新编译，二者 SHA-256 完全一致。正式 ZIP 仅把包内文件名调整为正式发布名称，不包含候选后缀。

## 已验收能力

- 学生详情只保留“手工选择原始资料库”和“手工选择学生知识库”两个独立入口；
- 两个入口分别选择、校验、确认，只修改各自路径；
- 取消选择或确认不会改变现有配置；
- 更改真实目录路径后，迁移分析能够纳入学生档案、成长模型、学情报告、教育档案和项目资料；
- 新电脑恢复成功，原始资料目录与学生知识库目录可以保持独立；
- 目录重绑定不移动、不复制、不删除用户原文件。

## 自动验证

- 全量自动测试：`783/783` 通过；
- 候选构建审计：前端资源 `68/68` 可达，不可达资源 `0`；
- 包内散落 `node_modules`：`0`；
- 源码、暂存运行时和安装包秘密扫描：均为 `0` 项发现；
- 正式 ZIP 条目：仅 `AI-edu-manager-console-Windows-0.16.7.exe`。

## 正式产物

| 产物 | 大小 | SHA-256 |
| --- | ---: | --- |
| `AI-edu-manager-console-Windows-0.16.7.exe` | 90,883,234 字节 | `A21DBA4F7969AEA06C1245F25D3627BD9C3DBA0670B6C4E585B990147B9571D8` |
| `AI-edu-manager-console-Windows-0.16.7.zip` | 90,891,538 字节 | `F95C707E979805F725AA5775768C41110EB7DA9DB8566DD7D175EF8C4B4E522B` |

## 候选对应关系

- 来源候选：`release/windows/candidates/path-rebind-two-buttons-v7/AI-edu-manager-console-Windows-0.16.7-path-rebind-two-buttons-v7.exe`；
- 来源候选 EXE SHA-256：`A21DBA4F7969AEA06C1245F25D3627BD9C3DBA0670B6C4E585B990147B9571D8`；
- 正式 EXE SHA-256：`A21DBA4F7969AEA06C1245F25D3627BD9C3DBA0670B6C4E585B990147B9571D8`；
- 结论：正式 EXE 与真机测试候选 EXE 逐字节一致。

## 签名边界

EXE 发行者元数据为 `Robogala`，Authenticode 状态为 `NotSigned`。本次“正式发布”指完成真机验收后进入正式下载目录的受控正式分发，不表示已经取得 Windows 公共代码签名证书。安装时应核对文件来源及上述 SHA-256。

## 回滚

上一正式版本 `0.16.5` 的 EXE、ZIP 和构建审计已复制到 `release/windows/archive/0.16.5/`。本次晋升未删除候选包或上一版本文件。
