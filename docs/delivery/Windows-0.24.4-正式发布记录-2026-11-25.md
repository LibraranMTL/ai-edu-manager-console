# Windows 0.24.4 正式发布记录

发布日期：2026年11月25日（北京时间）。状态：已正式发布，Windows版本码283。

## 发布结果与范围

- 下载页：https://www.greatbg.com/education/download.html
- 安装版：https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.24.4-Setup.exe
- 便携版：https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.24.4.exe
- ZIP：https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.24.4.zip
- 客户端清单：https://www.greatbg.com/download/edu-manager-version.json
- 产品站清单：https://www.greatbg.com/education/edu-manager-version.json
- 主机手册：https://www.greatbg.com/education/windows-host-manual.html（旧windows-manual.html入口同步）

按用户要求仅将Windows转为正式版。授权管理工具0.5.0仅内部保留，没有上传公开下载区；安卓1.3.9原证书签名候选仍等待真机验收，线上维持1.3.8/code42。学生端、教师端等其他客户端清单字段与发布前权威/download清单逐项一致；同步修正产品站原先滞后的清单副本。

## r2来源与版本修正

原r2候选及审计、r6/r7和既有源码修改均保留。发布前发现r2的界面更新码为282，若以283发布清单会继续提示自我更新。因此生成独立修正候选0.24.4-corrective-self-activation-release-r1，只修正内嵌更新码及派生的资源名称、引用和打包标签。

原r2 ASAR：f5fdf68ef6e9d4dbe5f73cd552d3661fb68db6f93c724c33dedba7ff068eb9f0

正式版 ASAR：591f76049edd77ecf92e20cff49a7f36fbcd394faf3a198c643a75873fb7baf2

严格比较477个业务文件一致；全部electron/shared/cloud-report-service业务模块无变化，界面规范化比较只允许282到283及由此派生的资源引用变化。正式便携包与原r2字节不同，不能使用原r2的B77D892E开头哈希校验正式包。依据：artifacts/windows-0244-promotion/runtime-comparison.json。

## 正式文件与SHA-256

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| AI-edu-manager-console-Windows-0.24.4.exe | 99200118 | A95A40E3FB58E274C8552FCC4F900628755F6FF4CA48C23F4A1F69BA84A649F6 |
| AI-edu-manager-console-Windows-0.24.4.zip | 99200334 | F1620DE8E6FCE13F7ABBA1841F82BB2DD4EDE17327F34998CA9C9D6596240499 |
| AI-edu-manager-console-Windows-0.24.4-Setup.exe | 99848745 | 4B3EBA8BD0A54CDC1F678C1A2F301233F1C2272D0AADE84A138B27DF7E3264FC |

两个公开清单SHA-256均为935740DB546457BE8817B254AB7C72AB4197150ECFC683393D91C2AF5D4E44F9。ZIP只包含正式命名的便携EXE，解压后与便携EXE哈希一致。安装器解包246个运行时文件与修正候选逐文件一致。

## 验证依据与边界

- 原r2此前在隔离环境完成首次联网激活、重复激活不增耗、显式恢复、重启保留、跨设备拒绝和提交后响应丢失恢复，5个测试码仅消耗2个，原正式授权、身份和学生索引未变。证据：D:/AI-Education-Manager/acceptance/activation-isolated-20261125-1795585539648/result.json。
- 修正版隔离界面再次通过同设备联网恢复，授权编号、令牌哈希及原到期时间不变；包内6项激活探针通过，相关授权测试25项通过，更新与安装器合同测试11项通过。原候选完整Windows回归502个测试文件通过，本次版本码修正未重新运行完整回归。
- 实际修正版主机访问已发布清单显示“当前已是最新正式版本”；旧版本码282判断为有更新。下载页实际Edge渲染、0.24.3回退展开和Android1.3.8展示已核验，无水平溢出。
- 所有上传内容在暂存区校验后替换；上线文件哈希/大小及0644 root:root核验，服务器本机HTTPS/SNI路由通过。公网两个清单、页面、两份手册完整正文哈希与本地相同；三个新包及三个回退包返回200且长度正确。
- 从当前Windows电脑完整下载正式安装器，99848745字节，SHA-256 4B3EBA8BD0A54CDC1F678C1A2F301233F1C2272D0AADE84A138B27DF7E3264FC，与本地一致。激活及云文档服务仍为active。
- EXE和安装版均未进行Authenticode签名，网页与清单已明示。安装向导、本机覆盖升级、旧P0完整恢复矩阵、客户现场验收没有执行，不将打包及逐文件比较等同于这些验收。

## 服务器与回退

实例i-m5e6r68cl11nbh2y0o6z，cn-qingdao。站点根目录/www/wwwroot/123.56.83.50；二进制和客户端清单在/download，网页、手册和站点清单在/education。

实际备份：/var/backups/edu-windows-0244-20261125-r2，保留原下载页、两处旧清单及手册。旧0.24.3安装器、EXE、ZIP继续保存在原下载地址，前后SHA-256核验相同；更早旧包和原r2也保留。网页提供0.24.3回退入口。0.24.3不支持新的自助激活码，新授权客户回退前应先由售后核验授权兼容性。

需要回退公开指向时，在该实例执行python3 /var/backups/edu-windows-0244-20261125-r2/rollback.py，再核验公网网页和两处清单。脚本从备份经同目录临时文件原子恢复小文件，保留所有不可变发行包；本轮未执行回退，也未回滚激活库存、许可证或用户资料。

暂存目录/tmp/edu-windows-0244-20261125-r2在全部验证后已核对真实路径并清除，回退备份保留。此次未提交或推送Git，未修改正在运行的用户主机资料或授权。

完整发布审计：artifacts/windows-0244-promotion/promotion-audit.json；公网核验：public-verification.json；完整下载：public-installer-sha256.json；界面与恢复：corrective-ui-acceptance.json。
