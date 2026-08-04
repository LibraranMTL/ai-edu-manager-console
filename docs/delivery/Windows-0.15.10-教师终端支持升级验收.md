# Windows 0.15.10 教师终端支持升级验收

## 升级范围

Windows 主机由 0.15.9 升级到 0.15.10。本轮只重新构建主机端；Windows 学生端保持 0.15.9，Android 学生端保持 0.6.10，Android 教师端为 0.1.0。

主机新增并持久保存教师终端角色。教师端配对后可以：

- 检索主机中的全部学生并查看资料状态；
- 查看选定学生的学情报告、成长模型和教育档案；
- 查看该学生关联项目中的 Markdown 项目知识；
- 把资料上传到选定学生原始资料库或其关联项目原始资料库。

上传行为只写入 Windows 主机资料库，不向学生设备发送文件、通知或已读任务。学生终端原有的个人/共享终端隔离规则保持不变。

## 构建产物

| 文件 | 大小 | SHA-256 |
|---|---:|---|
| `AI-edu-manager-console-Windows-0.15.10.exe` | 90,861,428 字节 | `7EF53475087156CC5ED3A493DDF8292037573AFC4F513DB4C5EBAE59253ECE65` |
| `AI-edu-manager-console-Windows-0.15.10.zip` | 90,868,836 字节 | `96B9891E96F5BF4890EA873A61108CF221E1017A0E045D63504366A5F8CD95E8` |
| `AI-edu-manager-teacher-terminal-0.1.0.apk` | 1,815,609 字节 | `FD410E9BEA53F97605B20301426200F4810D7E63E45DEB0A0D8D28913A97878C` |

构建审计文件：`release/windows/AI-edu-manager-console-Windows-0.15.10-build-audit.json`。

## 验收结果

- 用户验收反馈：教师端与 Windows 主机配套测试通过（2026-08-04）。
- 全量自动测试：653/653 通过。
- 前端资源：68/68 可达，不可达资源 0。
- 包内 `node_modules` 文件：0。
- 源码、暂存运行时和打包产物秘密扫描：0 项命中。
- `app.asar` 包内审计确认 `teacher-terminal-v1`、`teacherTerminalStudentRecord` 和教师角色授权判断均已进入安装包。
- 使用隔离用户数据目录启动打包后的 Windows 运行时，主进程、GPU、网络服务和渲染进程均持续运行，未发生启动即退出。
- EXE 产品元数据：`AI Education Manager Console / Robogala / 0.15.10`。

## 相关文档

- `README.md`：当前四端产品结构、版本和构建入口；
- `docs/00-产品白皮书-教育管家系统.md`：教师终端产品定位与资料流边界；
- `docs/delivery/Windows主机版操作手册.md`：主机升级、配对和设备角色检查；
- `docs/delivery/Android教师终端操作手册.md`：教师端安装、资料收集上传、档案查看、缓存与常见问题；
- `docs/delivery/装机人员检查清单.md`：四端安装与交付核对；
- `release/网站文件/download.html` 与四端网页手册：公开下载和使用说明。

## 签名边界

EXE 的 Authenticode 状态为 `NotSigned`。因此本包是完成构建与本机运行验收的受控升级包，应通过官方或已知可信渠道分发；它不代表已经通过公开代码签名证书门禁。
