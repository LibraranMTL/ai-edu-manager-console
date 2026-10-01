# Windows 主机版 0.19.4 正式发布记录

日期：2026-10-01。Windows versionCode：244。

## 验收与发布顺序

用户已明确确认“Windows 主机版已经通过真机测试”，并要求先生成正式包，再更新网页、文档、提交 Git 和使用 Workbench CLI 更新新阿里云实例。真机通过属于用户确认；没有收到逐项真机日志，不替用户补写操作细节。代码签名、自动测试、正式包启动和线上发布分别记录。

按原有便携产品形态生成正式 EXE／ZIP，不升级其他端、不修改云服务部署。正式构建使用同一 0.19.4 主机源码和正式文件名，不直接将候选清单标为线上发布成功。原候选包及其验收记录保持原样。

## 本地文件与 Git 范围

实施前备份：`.codex_tmp/windows-0.19.4-publication-20261001/`。保留原工作树中的 Android、轻终端、研究资料和其他未提交成果。

主机页面、运行时依赖、相应测试、发布脚本、版本清单、下载页和主机手册纳入本次受控 Git 提交。主机云文档联调测试依赖的既有云文档服务／网页源码一并保存，但本轮没有部署或升级云服务；Android 和轻终端的独立修改不纳入。不使用 `git add .`，不提交 EXE、ZIP、测试学生、用户数据、依赖目录或临时上传材料。用户要求提交 Git，未要求推送远程；本次不默认推送。

源码两个版本清单可以保留轻终端的本地候选版本；线上使用 `release/网站文件/edu-manager-version.json`，仅修改主机字段，其余字段逐项与服务器发布前清单比较，避免把未正式发布的其他端候选版本带到线上。

## 新实例与回滚

- 实例 ID：`i-m5e6r68cl11nbh2y0o6z`。
- 实例名称：`iZm5e6r68cl11nbh2y0o6zZ`。
- 区域：`cn-qingdao`；公网 IP：`47.104.192.137`。
- 当前域名 A 记录与新实例公网 IP 一致；未访问或修改旧北京实例。
- 已验证站点根目录：`/www/wwwroot/123.56.83.50`。目录保留旧 IP 名称，不表示仍在旧实例发布。
- 服务器备份：`/www/backup/ai-edu-0.19.4-20261001-qingdao/`，包含被覆盖的五个小文件及新包不存在记录；旧版 0.17.11 下载文件不删除。
- 暂存目录：`/tmp/ai-edu-0.19.4-20261001-qingdao/`。

发布文件为两个主机安装包、下载页、主机手册和兼容手册、`education` 与 `download` 两份公开清单。上传到暂存后先核对 SHA-256、JSON、版本和链接，再以同目录临时文件原子替换，保持 `0644 root:root`；不修改 Apache 配置或重启服务。

回滚时将备份中的五个小文件复制到对应目录临时名并原子替换，恢复旧清单和页面链接后验证公网。新 0.19.4 包可保留为历史文件，不删除仍被页面或清单引用的包。

## 校验结论

正式构建完成于 `2026-10-01T09:23:34Z`，`candidateTag` 为空。主机仍为 0.19.4，未因为正式构建额外递增版本。

| 线上路径（相对于站点根目录） | 字节 | SHA-256 |
| --- | ---: | --- |
| `download/AI-edu-manager-console-Windows-0.19.4.exe` | 98949291 | `25A4DC99572E697DC3FD91C82AC14AC1A5F0D284B0057C0EF15362FE806EDBEA` |
| `download/AI-edu-manager-console-Windows-0.19.4.zip` | 98960729 | `F928E9072EE870031C25411905FC521BF2952913884A8D4A18B2DA9F67358BFC` |
| `education/download.html` | 10168 | `63BA2C2C25551352F249CC493C48799584CDDB233FB48E69ACE80BDF23545979` |
| `education/windows-host-manual.html` | 88958 | `06672DDAE919F69822A5FC4AB6DDF194F265E71ED0BCE62DB5B7BAD8A225BF0A` |
| `education/windows-manual.html` | 88958 | 同上 |
| `education/edu-manager-version.json` | 2273 | `153B334B81588A073ADBA6859FF435313A31CF002F84BB4131F83152DBB3346F` |
| `download/edu-manager-version.json` | 2273 | 同上 |

- 自动回归：1736 项，1735 通过、1 跳过、0 失败；98199 ms。最初有两条测试写死旧 0.17.11 下载版本／文件名，改为依据公开清单校验后通过，包存在性、其他端链接和手册断言仍保留。
- 正式构建包含 Vite、发布暂存和包体审计；源码 288 文件、暂存 502 文件及 2 个包体敏感签名扫描均 0 发现。构建审计保留于 `release/windows/AI-edu-manager-console-Windows-0.19.4-build-audit.json`。
- 正式包 FileVersion／ProductVersion 均为 0.19.4；Authenticode 为 `NotSigned`。用户真机通过不等于程序已签名。
- ZIP 只有一份 `AI-edu-manager-console-Windows-0.19.4.exe`，解包内容哈希与正式 EXE 一致；没有候选命名或测试学生数据。
- 正式包与用户验收候选的全部前端文件哈希一致，main、preload、下载收件箱及其他主机运行时源码一致。仅生成的 `agent-lifecycle-hook.exe` 因重新编译发生二进制差异，其 C# 源码相同。正式包是重新构建，不宣称与候选外层 EXE 二进制完全相同。
- 正式 EXE 使用独立 `formal-qa-user-data` 实际启动，便携解包进程加载 `app.asar/dist/index.html`，页面标题为“AI教育管家控制台”。没有激活真实用户授权或访问真实学生资料；这项是隔离启动，不是替代用户真机验收的完整业务复测。
- 7 个线上目标文件哈希与本地冻结库存一致，权限与属主为 `0644 root:root`。本机和服务器分别验证 5 个小文件的公开 HTTPS 正文哈希；正式 EXE、ZIP 的 HTTPS HEAD 为 200，长度与表中一致。未通过公网完整下载大包再次哈希，包体完整性由暂存／线上文件哈希和公开长度共同校验。
- 新实例上的本地 Apache HTTPS 路由校验通过，TLS 验证没有禁用；无需重启服务。旧北京实例未改动。
- Windows 学生端 0.16.10、Android 学生端 0.6.16、教师端 0.1.1、单机版 1.2.2 的原下载链接均返回 200；其他端的线上清单字段逐项保持原值。

公开入口：https://www.greatbg.com/education/download.html。主机手册：https://www.greatbg.com/education/windows-host-manual.html。

本次网页只更新下载页和两份主机手册；其他端网页与产品首页不替换。临时上传材料在公网校验后清理，回滚备份长期保留。Git 提交与服务器发布分开操作，提交号见本次交付消息及本地 `git log`；不推送远程。
