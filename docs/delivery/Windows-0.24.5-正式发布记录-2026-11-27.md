# Windows 0.24.5 正式发布记录

2026-11-27 发布 Windows 主机 0.24.5，版本码 284。该版完善资料收件箱已核验结果优先投递、技术恢复和人工确认事项展示。

生产实例为青岛 `i-m5e6r68cl11nbh2y0o6z`。安装包 SHA-256 为 `99B7D04CC3C207601A1DB6C90CA7B45A62642ED802249B589A483CCA419D0A90`，99,850,705 字节。便携 EXE SHA-256 为 `DFFB2ECE09196C2E7A7CFED406FF078AD3FFEA106F7375A5E656789EEC6F95AA`，ZIP SHA-256 为 `45FA3C3B0BC262F6102CAD6A11E476701AC3BC2AF277996A24FD323C36A22092`。Windows 工件未签名。

中文和英文下载页及两个版本清单的公网内容哈希与本地一致，三个主机包公网 HEAD 均返回 200 和预期长度。学生端 Windows 0.19.3、Android 0.6.34，教师端 Android 0.1.5，以及 Android 单机版 1.3.9 的现网链接返回 200。0.24.4 三种主机包仍可下载。

服务器替换前备份为 `/www/backup/edu-windows-0245-20261127`，隔离暂存目录已经清理。安装包解包后 246 个运行文件与已测试的便携候选逐一相同。包内探针和隔离启动测试通过，沿用 r5 的完整 Windows 502 文件回归和 135 项专项测试。安装向导未在独立 Windows 用户环境中执行，真实历史积压的持续性能尚未复验。

下载页分别为 https://www.greatbg.com/education/download.html 和 https://www.greatbg.com/education/download-en.html。Git 默认分支提交 `7666a54` 包含本版源码与页面；项目介绍提交 `ef9e603`。浏览器自动化连接超时，本轮完成页面源码、链接和公网哈希核对，页面视觉复核未完成。
