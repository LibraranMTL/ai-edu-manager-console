# AI教育管家 Windows 主机 0.17.10 正式发布记录

## 范围与验收边界

- 发布内容：已完成批次学习事件补录，以及与之配套的 Windows 主机端代码、下载页、主机操作手册、网页手册、白皮书和版本清单。
- 用户确认 `0.17.9-learning-events-supplement-20260922` 候选包已通过真机测试。正式版依照版本递增规则重建为 `0.17.10`（版本码 `229`）；这份用户确认不能等同于对 `0.17.10` 文件本身的逐字节真机复测记录。
- Windows 学生端、Android 学生端、Android 教师端、Android 单机版的正式下载版本不变。Android 端侧自动采集仍为候选状态，不在本次正式发布范围内。

## 构建与校验

- 构建命令：`node scripts/build-windows-release.cjs`。隔离构建审计记录在 `release/windows/AI-edu-manager-console-Windows-0.17.10-build-audit.json`（本地生成文件，按仓库规则不纳入 Git）。审计结果：打包 ASAR 完整性检查通过，源文件、暂存运行时与产物密钥扫描均为零发现。
- 自动测试：`pnpm test`，`1059` 项中通过 `1058` 项、跳过 `1` 项、失败 `0` 项。
- EXE：`AI-edu-manager-console-Windows-0.17.10.exe`，`91,023,298` 字节，SHA-256 `E5C341DC1ACE120A9E22304D1C17829AA8EEC03A63D6C4DF5FE783DA21405585`。
- ZIP：`AI-edu-manager-console-Windows-0.17.10.zip`，`91,031,724` 字节，SHA-256 `8E2855320F27E0AB0AFD494D795353A039ADDA50A54A16A7D0FA7BACD6002650`。
- Windows `Get-AuthenticodeSignature` 对 EXE 返回 `NotSigned`。构建日志中的签名步骤与发行者元数据不能代替有效的 Authenticode 签名；本次仅在既有受控渠道分发，首次运行可能出现系统警告。后续若要求签名版，须使用正式代码签名证书重新签名并重新验收哈希。

## 上线与回退

- 阿里云 ECS：`cn-beijing / i-2ze2bk4vcw3rm1oiesj1`。站点目录：`/www/wwwroot/123.56.83.50`。
- 新安装包位于 `/download/`；更新的 `download.html`、`windows-host-manual.html`、兼容别名 `windows-manual.html` 和 `/education/edu-manager-version.json` 位于 `/education/`；`/download/edu-manager-version.json` 同步更新。
- 上线前的五个被替换文件备份于 `/www/backup/edu-manager-0.17.10-20260922-0900/`。旧版本安装包未删除。需要回退时，应先撤回两处新版本清单和下载页，再恢复两份网页手册；使用备份文件逐项恢复并验证哈希，不直接删除旧版文件。
- 六个上传文件在隔离暂存目录 `/tmp/edu-manager-0.17.10-20260922-0900/` 逐一核对 SHA-256 后上线；线上服务器文件再次核对一致。公开 HTTPS 下载页、两份手册、两处版本清单均返回 `200` 且内容哈希与本地一致；EXE、ZIP 返回 `200` 且 `Content-Length` 分别为 `91,023,298`、`91,031,724`。
- 下载入口：[AI教育管家下载页](https://www.greatbg.com/education/download.html)。

## 源码状态

- 打包时源工作树包含既有未提交的产品开发改动，构建审计记录基底提交为 `23b82af8f540f07b0e01e483eff13f08fa6a41d2`。因此不能只用该基底提交复现本次安装包；应结合本次发布提交、构建审计与产物哈希追溯。
- 本记录不声称正式重建包经过独立真机复测，也不声称具有有效数字签名。
