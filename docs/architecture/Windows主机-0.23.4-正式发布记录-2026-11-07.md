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
