# Windows 主机 0.23.4 正式发布记录

## 发布范围

- 正式版本：`0.23.4`，Windows 版本码 `273`。
- 源码提交：`7cc2ef128bb744b875a5564f2a2f01ba58a98e2b`。
- 二进制来源：`0.23.4-corrective-automation-20261107-r2` 的同一已审计运行时；便携 EXE 与安装器只更换为正式文件名，未重新编译。
- 发布目标：青岛生产实例 `i-m5e6r68cl11nbh2y0o6z`，下载目录 `/www/wwwroot/123.56.83.50/download`，下载页目录 `/www/wwwroot/123.56.83.50/education`。

## 制品与校验值

| 文件 | SHA-256 | 说明 |
| --- | --- | --- |
| `AI-edu-manager-console-Windows-0.23.4.exe` | `BC77A7CF260796B9EAF7A37280CA8D9F16A72895283F146BB658C2E02CBAE168` | 便携 EXE |
| `AI-edu-manager-console-Windows-0.23.4.zip` | `B832C18C72D383055A870332225D5BF3BE70830FD2926346ADEBF3B01ECD1AD5` | 内含唯一正式命名的便携 EXE |
| `AI-edu-manager-console-Windows-0.23.4-Setup.exe` | `CD31931A1971BA840F06F0ED6506647A4C56BDF8BBB6B045AA4DF8D51090FBBD` | Windows 安装器 |

ZIP 内 EXE 的 SHA-256 与便携 EXE 相同：`BC77A7CF260796B9EAF7A37280CA8D9F16A72895283F146BB658C2E02CBAE168`。

## 验收与边界

- 候选构建审计记录了干净源码、0 项源代码/暂存/包内密钥扫描发现、资源审计通过；Windows 自动化与公共课程定向测试已通过。
- 本版包含公共课程签名同步、按学生隔离的课程 v2 投影、WorkBuddy 外部启动状态识别，以及资料投递、受限产物修复与积压收敛纠偏。
- 平台精选课程的本地创作和发布 UI 已收起；机构本地课程管理仍保留。
- 三个 Windows 制品的 Authenticode 状态均为 `NotSigned`。发布状态为官网稳定下载可用，不代表 Authenticode 签名或真实设备验收已完成。
- 发布操作必须保留服务器备份，按“二进制 → 清单 → 下载页”同目录临时文件原子切换，并以公网 HTTPS 再核验哈希与内容。

## 生产发布验证

- 回滚备份：`/www/backups/windows-0.23.4-20261107-7cc2ef1`，保留发布前的下载清单、教育站清单和下载页；旧 `0.23.3` 三种包仍保留在下载目录。
- 服务器端正式文件、两个清单和下载页的 SHA-256 均与本地暂存值一致。
- 公网 HTTPS 已验证返回 `200`：
  - `https://www.greatbg.com/download/edu-manager-version.json`：`0.23.4/273/stable`，SHA-256 `96559c2304492aa64b17f4454262ce00f057196cc2e94caf4395af1fa8ebe5ed`。
  - `https://www.greatbg.com/education/download.html`：SHA-256 `8356bc4b29218375324e963739649ef19f0198559cab125fbd50b71481500724`，包含三种 `0.23.4` 下载链接。
  - 便携 EXE、ZIP、安装器的公网 `Content-Length` 分别为 `99143136`、`99153570`、`99784207` 字节。

## 下载页 Android 版本纠正（2026-11-07）

- 发现原因：Windows `0.23.4` 发布时，客户端更新清单仍正确声明 Android 学生端 `0.6.27/97`、教师端 `0.1.5/6`；但被整体替换的静态下载页仍是旧源文件，重新写入了学生端 `0.6.26` 和教师端 `0.1.4` 的显示及链接。因此是下载页与清单的双来源不同步，不是 APK 或更新清单回滚。
- 已恢复并以 HTTPS 逐页 SHA-256 验证：下载页 `66571f1fdbf0d9b6bb94a62882f388aa772d0f3cc20e83de74a806839ba08973`、Android 学生端手册及 `tablet-manual.html` `27142f69ae93984598c8bbbc5c98d616c4f6f245fcbca1e63d31af5f85dd2b53`、Android 教师端手册 `04904212a73a25a7bf52baaf469df856f15ed4ca8fdafe390e230644c29c1a05`。两个 APK 下载端点均返回 `200`。
- 本次静态页修复回滚备份：`/www/backups/website-mobile-version-repair-20261107-1215`；服务器暂存目录已删除。
- 防复发：新增 `verify:release-website`，对三个版本清单、下载页、两份 Android 手册和学生端兼容手册强制比对；`build:win` 与 Windows 发布构建脚本均会先执行该检查。另提供 `sync:web-manuals:android`，只生成 Android 两个产品族的手册，避免范围外页面被重写。

## Windows 主机手册纠正（2026-11-07）

- 发现官网 `windows-host-manual.html` 和兼容入口 `windows-manual.html` 仍由 2026-10-23 的旧手册生成，标注 `0.21.6`，并保留已退出的本机平台课程草稿、发布和导出操作。
- 已将源码手册更新为 Windows `0.23.4/273`：说明平台课程由云端发布管理维护、主机只负责安全同步/预览/学生分配，并补充课程签名、撤回、投影隔离与自动化纠偏边界。
- 两个官网入口的 HTTPS SHA-256 均为 `68a9c6e5bea29b0337165725d56e3415fa5aa5bbfa6c81ad0ce9914a93a7d81b`，返回 `200`；回滚备份保留于 `/www/backups/windows-host-manual-0234-repair-20261107-1230`。
- 文档测试现在同时断言 `0.23.4/273` 与云端课程发布说明，并拒绝旧的“保存平台草稿”“发布并导出平台课程包”指引。
