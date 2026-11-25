# 批量兑换码与自助激活

正式入口：`https://www.greatbg.com/edu-activation`。此服务独立于 `/edu-cloud` 的学生资料服务；不采集学生档案，不使用云同步开通码。服务端负责一次性兑换和设备绑定，客户端仍使用原 License v3 本机验签。旧 `AIE3` 授权码和文件导入继续有效。

## 发码与客户操作

授权管理工具 0.5.0 中使用“批量兑换码”面板，登录后按产品、套餐、数量、学生席位、学生终端额度和期限生成批次。默认 Windows 一码绑定一台主机，允许连接的学生终端额度另设，不能把两者混为一项；安卓单机版一码绑定一台安卓设备。

本机先加密保存完整库存，服务器确认登记摘要后才开放交付。网络失败的批次点击“续接登记”，不要另建相同订单代替。可明确展开完整交付码、生成二维码或导出 CSV；默认列表不展示完整码。兑换截止日期与许可证有效期分开，后者从首次成功兑换起算。

客户输入 AEC1 开头的码后自动联网兑换，AIE3 开头的旧许可证继续离线核验。同身份、同设备证明恢复返回同一许可证和原到期日；不会因重试延长授权。身份或保护凭据变化、换机、恢复出厂设置由售后核验。暂停批次和作废未兑换码不会即时撤销已经签发的离线许可证。

## API

所有请求使用 JSON、HTTPS，管理接口使用短期 Bearer 会话。兑换码不得放在 URL 或日志中。

| 路径 | 用途 |
| --- | --- |
| `POST /v1/admin/login` | 密码换取30分钟会话；密码以 scrypt 加盐摘要保存 |
| `POST /v1/admin/batches` | 按 id 幂等登记；最多1000个 SHA-256 码摘要 |
| `GET /v1/admin/batches?offset=0` | 每页100批，返回总量、已兑换、作废及到期状态，不返回码摘要 |
| `GET /v1/admin/activations?offset=0` | 每页100个签发登记，不返回许可证 |
| `GET /v1/admin/status` | 近15分钟请求和错误、最长服务耗时、磁盘、备份及告警 |
| `POST /v1/admin/batches/:id/actions` | `pause`、`resume`、`void`；作废只影响未兑换码 |
| `POST /v1/activations/redeem` | 首次兑换，或返回同身份已经提交的结果 |
| `POST /v1/activations/recover` | 仅查询已提交结果，不消耗库存或新签发 |

批次字段为 `id/productId/edition/students/terminalDevices/durationDays/redeemBefore/hashes`，可附 `orderNo/customer`。`terminalDevices` 是学生终端配额；省略时保守沿用1。支持 TRIAL、FAMILY、PRO、ORG；平台版继续受控离线签发。

兑换请求字段为 `operationId/productId/deviceId/publicKey/codeHash/timestamp/nonce/signature`，首次兑换附 `code`。公钥为 P-256 SPKI DER 的 Base64，签名为 SHA256withECDSA DER Base64。签名正文按换行拼接路径、operationId、productId、deviceId、publicKey、codeHash、timestamp、nonce。容许5分钟时钟偏差；nonce 防重放。权益从登记批次取得，客户端不提交授权权益。

成功返回 `ok/licenseToken/operationId/recovered`。错误包括 `INVALID_CODE/INVALID_PROOF/PRODUCT_MISMATCH/DEVICE_BOUND/CODE_VOID/CODE_EXPIRED/BATCH_PAUSED/OPERATION_CONFLICT/NOT_COMMITTED/SERVICE_FROZEN/RATE_LIMITED`。已兑换码即使随后超过兑换截止期，仍可恢复原许可证；过期许可证不会自动续期。

## 运维与恢复

- 配置在 `/etc/edu-activation/config.json`，独立签发私钥和备份加密密钥仅保存在受控目录；初始化密码建库后从配置中移除。客户包只包含公钥。
- 独立 systemd 服务监听 `127.0.0.1:8758`；Apache 反向代理显式开启 `ProxyAddHeaders`。只信任代理追加的最后一个客户端地址，不能把后端端口对外开放。
- 每日北京时间03:20产生 AES-256-GCM 加密备份，包含一致性 SQLite 快照及签发恢复材料。Windows 每日04:10拉取并校验 SHA-256，成功后登记异地接收时间。电脑关闭或用户未登录时会延后；服务监控对超过36小时的备份或异地确认显示告警。
- 每5分钟检查公网存活、近15分钟服务错误、超过5秒的请求、512MiB空间下限和备份状态。告警进入 systemd/journal 和授权管理页，不自动向外发送消息。
- `node activation-service/maintenance.cjs backup <配置路径>` 手动备份；`restore <配置路径> <加密备份> <不存在的新目录>` 校验并恢复。恢复库默认冻结新兑换，清空管理会话；对照恢复点后的兑换审计和客户回执核对后才能人工解冻，不能直接复活库存。
- Windows 当前用户下的运维密码和备份恢复密钥使用 DPAPI 保护。换管理电脑前必须安排恢复材料交接；不能把 DPAPI 密文当作任意电脑通用的恢复密钥。
- 应用回滚保留数据库和已兑换记录，不回滚库存。部署脚本和备份目录记录具体回退点；恢复主站代理配置后，需要保留已签发客户端的本地授权能力。

## 验证

`node --test tests/activation-service.test.cjs` 覆盖签发、重复恢复、跨产品/设备、签名和重放、批次暂停/作废、截止期、冻结、备份恢复与防篡改、客户端响应丢失续接、管理库存并发登记及学生终端额度。

公网验收脚本 `scripts/verify-online-activation.cjs` 通过 Electron 使用受保护运维凭据，只建立标记为 QA 的三天试用批次。验收记录不包含完整兑换码或许可证。模拟器验证与真实设备验收分别记录。
