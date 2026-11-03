# Windows 0.23.0 正式发布准备记录

## 发布基线

- 源码分支：`codex/windows-0230-foundation`
- 已验收运行时提交：`e0bccc546854a29996850632421cc177805a6385`
- 便携候选：`0.23.0-p13-weekly-upload`
- 正式版本：Windows `0.23.0`，稳定清单版本码 `269`
- 生产实例：阿里云青岛 `i-m5e6r68cl11nbh2y0o6z`；退役北京实例不在本次发布范围。

## 正式产物

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `AI-edu-manager-console-Windows-0.23.0-Setup.exe` | 99,752,377 | `A2B1A0422FE875E8D87559390B5093485C190E8FBF4D297B7FC636D30C867077` |
| `AI-edu-manager-console-Windows-0.23.0.exe` | 99,100,407 | `90DA185FAA61C5F712FF77BCB8F63B081896BDFA61985A514EFDE46DF9C1F2A8` |
| `AI-edu-manager-console-Windows-0.23.0.zip` | 99,110,412 | `5B9329ABB19DBE552FE6D1EAE8068BE728583B06AA144950D51DDD6297CEE48D` |

## 构建与验证事实

- 安装包直接从已验收便携运行时封装，未重新编译业务源码。
- 安装包解包后逐一比对 246 个运行时文件，全部与已验收便携运行时一致；`app.asar` SHA-256 为 `2840ADBD060F9F17E2D820A344C47A8FCF83B6979C1FBFAA20E459C573BE2686`。
- 正式 ZIP 解压后的 EXE SHA-256 为 `90DA185FAA61C5F712FF77BCB8F63B081896BDFA61985A514EFDE46DF9C1F2A8`，与正式便携 EXE 完全一致。
- 安装包与便携 EXE 的 Authenticode 状态均为 `NotSigned`；本记录不将未签名产物描述为已签名。
- 安装向导尚未在开发机真实执行；本次完成的是安装器载荷逐文件一致性验证。

## 发布内容

- 学情状态、自动行动闭环、学习方法与整体画像整合为完整学情资料，学生端与教师端均可查看。
- 项目综合报告与项目资料中心分为两个页签，项目列表采用轻量投影，避免 IPC 载荷超限误报为 0 个项目。
- 资产统计使用统一快照与代次校验，修复整体趋势和近期变化长期不更新。
- 每周分享图改为“本周新上传资料 + 累计文件资产”，用于社群分享和上传奖励，不推断知识掌握度。
- 新增首页五入口、启动稳定版更新提醒和作品集项目模板。

## Git 发布

- 正式发布提交：`ff73c6dc67c7cdf4f12390cd7ecfbb337c123482`。
- 远程分支：`origin/codex/windows-0230-foundation`。
- 正式标签：`v0.23.0`，已推送到 `https://github.com/LibraranMTL/ai-edu-manager-console.git`。

## 阿里云正式发布

- 实例：青岛 `i-m5e6r68cl11nbh2y0o6z`，公网地址 `47.104.192.137`；未访问或同步退役北京实例。
- 站点根目录：`/www/wwwroot/123.56.83.50`。
- 回滚备份：`/www/backups/windows-0.23.0-20261103-ff73c6d`，包含发布前页面、两份清单、0.22.8 三个 Windows 包及发布前哈希清单。
- 上传使用独立 `/tmp/edu-manager-windows-0.23.0-20261103-1049` 暂存目录，上传后逐文件核对字节数和 SHA-256，并校验 JSON 与页面引用。
- 切换顺序为三个二进制、两份版本清单、下载页；每个目标先写入同目录临时文件，再原子重命名。发布后已删除精确暂存目录，回滚备份保留。

## 公网验收

- `https://www.greatbg.com/education/download.html` 返回 HTTP 200，并引用 0.23.0 的 Setup、EXE 和 ZIP。
- `/download/edu-manager-version.json` 与 `/education/edu-manager-version.json` 均返回 HTTP 200、内容一致，Windows 字段为 `0.23.0 / 269 / stable`。
- 三个下载地址均返回 HTTP 200，公网 `Content-Length` 分别为 99,752,377、99,100,407 和 99,110,412 字节，与正式清单一致。
- 安装包从公网完整反向下载后 SHA-256 为 `A2B1A0422FE875E8D87559390B5093485C190E8FBF4D297B7FC636D30C867077`，与本地和服务器暂存文件完全一致。

## 剩余边界

- Windows 产物仍未进行 Authenticode 签名。
- 安装器载荷已逐文件验证，但本次未在开发机覆盖执行安装向导，也未以此替代单独的用户设备升级与回滚验收。
