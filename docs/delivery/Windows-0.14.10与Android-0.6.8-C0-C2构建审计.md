# Windows 0.14.10 / Android 0.6.8 C0—C2 构建审计

日期：2026-07-30
状态：受控候选；源码与自动门禁完成，公开发布待外部门槛。

## 1. 本次范围

- C0：课程目录 Schema、首批 Starfall / Code.org 条目、封面清单、HTTPS 精确域名、版本、校验、RSA 签名、最后可用版本、失败回滚、离线导入和商务边界；
- C1：Windows 主机、Windows 学生端、Android 学生端统一“精选课程”，当前学生有效目录，隔离 `WebContentsView` 和安全 WebView；
- C2：默认待开始的课程资料采集、课程来源归因、学生或有效关联项目目标、机构启用/隐藏/排序/年级/学生分配、紧急下架、手册、网站源文件与候选构建。

不包含 C3 课程运营管理中心。

## 2. 自动验证

| 检查 | 结果 |
| --- | --- |
| 全量自动测试 | `562/562` 通过 |
| Windows 主机生产前端 | 通过 |
| Windows 学生端生产前端 | 通过 |
| Android Java / resources / dex / APK | 通过 |
| Android APK 签名结构 | v1 / v2 / v3 通过 |
| Windows 主机包内审计 | `177` 个 ASAR 文件，`node_modules=0` |
| Windows 学生端包内审计 | `18` 个 ASAR 文件，`node_modules=0`，`334435` 字节 |

主机 ASAR 已复核包含签名目录、公钥、两张封面、`course-catalog`、`course-catalog-store` 和 `course-browser`。学生端 ASAR 已复核包含 `course-catalog` 与 `course-browser`，课程目录和封面从当前学生范围主机 API 获取。

## 3. 候选产物

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `AI-edu-manager-console-Windows-0.14.10.exe` | 90,546,774 | `FF638D5F25A6F4A0B0188683E9D9D7F9D754BBA2E87CA072998C9DE9782694E3` |
| `AI-edu-manager-console-Windows-0.14.10.zip` | 90,555,653 | `D366C6712148FC4C70B9549FD28C216CA407DDB314B3DC932A641F9A1AFCF160` |
| `AI-edu-manager-student-terminal-Windows-0.14.10.exe` | 85,535,380 | `F535469EDC78330C7A59474BE2273DE53E4DD5FF0D007EC6343402D59C0751CB` |
| `AI-edu-manager-tablet-terminal-0.6.8.apk` | 1,811,432 | `94AED660A767D61F285715F16EE34795FF04365A3D83C7A8A31E531C678D8FFD` |

两个 Windows EXE 的 `FileVersion` / `ProductVersion` 均为 `0.14.10`，`CompanyName=Robogala`，Authenticode 状态均为 `NotSigned`。Android APK 使用项目调试证书，不是正式发布证书。

## 4. 自动门禁已覆盖

- 签名、校验值、主机最低版本、篡改、无签名、未知域名和危险协议拒绝；
- 最后可用目录与无效离线包回滚；
- 机构启用、排序、年级和精确学生范围；
- 紧急下架后不进入有效目录；
- Windows 浏览器进程隔离和权限拒绝；
- Android 无 JavaScript Bridge、无文件/内容访问、无混合内容、权限拒绝；
- 课程采集归因和重复记录幂等；
- 三端包内课程资产和启动模块存在性。

## 5. 公开发布前必须完成

1. 正式确认两张课程封面的图片使用权、第三方商标和课程描述，更新 `course-catalog/compliance-assets.json`；
2. Windows 主机、Windows 学生端和 Android 学生端逐项真机验证课程显示、登录、返回、断网、重定向、未知域名、系统录屏授权、暂停/结束、学生目标、项目目标和重复上传；
3. 取得并应用 Windows Authenticode 证书；
4. 使用 Android 正式发布证书重新签名并复核升级兼容；
5. 重新计算正式产物哈希并另建正式发布审计。

在以上门禁完成前，本批产物仅适用于受控开发验收，不得表述为公开稳定版，也不得把打开课程或采集屏幕资料表述为课程完成、正确率或学情结论。
