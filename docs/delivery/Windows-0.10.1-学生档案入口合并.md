# Windows 0.10.1 学生档案入口合并

发布日期：2026-07-22

## 本次调整

- 将 Windows 主机端原有的“初始化教育管家”和“新建教育智能体”合并为一个“新建学生档案”入口。
- 首次引导、左侧导航和“学生档案”旁的新增按钮统一进入同一个创建页面。
- 保留原有学生档案初始化流程、知识库创建方式和 Agent 工具连接能力，不迁移、不删除既有学生数据。
- 同步更新 Windows 主机端、Windows 学生端版本为 0.10.1；Android 学生端保持 0.6.2。

## 验证结果

- 自动化测试：271/271 通过。
- 页面交互：导航中只有 1 个“新建学生档案”，不再显示旧入口名称；点击“新增学生”可进入创建表单。
- 浏览器控制台：无 error 或 warn。
- 主机端打包审计：68/68 前端资源可达，包内无运行时 `node_modules`。
- 学生终端打包审计：包内无运行时 `node_modules`。
- Windows 主机版操作手册 PDF 已重新生成并完成首页版式检查。

## 发布产物

| 产物 | SHA-256 |
| --- | --- |
| `AI-edu-manager-console-Windows-0.10.1.exe` | `B91E7D7388A7492CFB808648E85D5FCEAC80C5E47D0AE34DF94B1D7AEB75E742` |
| `AI-edu-manager-console-Windows-0.10.1.zip` | `E671E3C54C7B36408943ADA75EA89D58D3BDA5363D84C65B3C7C98BD27017937` |
| `AI-edu-manager-student-terminal-Windows-0.10.1.exe` | `EBECA7FE7404C21A7AD4E8AA212C8479EBD352F4C7D5A8856EA80DB1C3A1AE9A` |

Android 端没有代码变化，因此未重复打包，继续使用 `AI-edu-manager-tablet-terminal-0.6.2.apk`。
