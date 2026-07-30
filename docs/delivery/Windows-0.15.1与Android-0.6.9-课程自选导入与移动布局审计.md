# Windows 0.15.1 与 Android 0.6.9 课程自选导入与移动布局审计

审计日期：2026-07-30

## 1. 本次范围

- Windows 主机为已激活的专业版和机构版增加四字段自选课程 Excel 导入。
- 平台 RSA 签名目录与机构自选目录分开保存、合并展示；自选课程不能覆盖平台课程。
- Android 手机竖屏和自适应布局不再沿用平板横排权重，修复课程封面下方异常留白。
- 用户已确认各版本真机课程打开正常。该确认只覆盖课程打开路径。

## 2. Excel 导入合同

- 文件格式：`.xlsx`，单文件不超过 10 MB，读取第一个工作表。
- 表头：前 10 行内必须出现“课程名称、课程图片、课程简介、课程链接”；四列均为必填。
- 数量：一次及机构目录总量最多 200 门。
- 文本：课程名称最多 120 个字符，课程简介最多 1200 个字符。
- 图片：支持同目录文件名、完整本地路径、`file://` 地址或 HTTPS 图片网址；支持 PNG、JPG/JPEG、WebP，单张不超过 5 MB。
- 链接：必须使用 HTTPS，不允许嵌入用户名或密码；精确主机名自动成为该课程的访问白名单。
- 更新：课程链接规范化后生成稳定课程 ID；相同链接再次导入时更新原课程。
- 权限：导入和向学生端下发均重新检查当前许可证，只有激活的 `PRO / ORG` 可用。

## 3. 自动化与包内验证

- 全量自动测试：`567/567` 通过。
- Windows 主机生产构建：通过。
- Windows 学生端生产构建：通过。
- Android `0.6.9` APK 编译：通过。
- 主机候选包保持零 `node_modules`；ExcelJS 已预打包进 `course-custom-import.cjs`，包内审计确认不再引用外置 `exceljs`。
- 从主机 ASAR 解出的导入模块实际生成 Excel 模板，并由 ExcelJS 重新读回；工作表为“课程导入、填写说明”，首表四个表头准确，冻结首行且筛选范围为 `A1:D51`。
- Android APK 通过 v1/v2/v3 签名校验；v3.1、v4 和 SourceStamp 未启用。

## 4. 候选文件

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `release/windows/AI-edu-manager-console-Windows-0.15.1.exe` | 90,816,888 | `0EB8C10970AC8896C73BF63511BF2B19863C934B68A53374E0840CE2CEE6F6B1` |
| `release/windows/AI-edu-manager-console-Windows-0.15.1.zip` | 90,825,346 | `42A68704A84CB2F74B1A13C67EDA042004CB0E1EA4535F051B712BDA63757087` |
| `release/windows-terminal/AI-edu-manager-student-terminal-Windows-0.15.1.exe` | 85,534,685 | `B0FD3D13A4D5908E5C690D02C84B4129B22645C159CE495FD494A02DE5A4125A` |
| `release/tablet-terminal/AI-edu-manager-tablet-terminal-0.6.9.apk` | 1,811,432 | `0BF0C82FB0B1BB687B6993DB6EF58F62C10F4AC1CC23E1F51223278151ED8AF0` |

两个 Windows EXE 的产品版本均为 `0.15.1`，公司为 `Robogala`，Authenticode 状态均为 `NotSigned`。Android 使用项目调试证书。上述文件是受控候选，不是已经完成全部公开发布门禁的稳定版。

## 5. 尚未关闭的人工门禁

- 在 Android 手机竖屏真机上复核本次布局修复，确认文字、按钮和下一张课程卡片紧随封面之后。
- 在已激活专业版、机构版主机上分别完成：下载模板、同目录图片导入、HTTPS 图片导入、重复链接更新、学生分配和学生端打开。
- 继续执行登录、重定向、断网、系统录屏授权、学生/项目入库和重复提交真机验收。
- 正式确认首批封面图片使用权、商标和课程描述。
- 公开分发前配置 Windows Authenticode 与 Android 正式发布证书，或继续采用明确的受控分发策略。
