# Windows 0.14.10 精选课程开发前里程碑

日期：2026-07-30

## 定位

`0.14.10` 是“精选课程”功能加入前的可回滚冻结点。它基于已提交并受控发布的 Windows `0.14.9` P6 教育资料自动闭环代码，只更新版本号、发布清单和里程碑记录，不加入新的业务功能。

配套版本：

- Windows 主机端：`0.14.10`
- Windows 学生端：`0.14.10`
- Android 学生端：`0.6.7`（代码与安装包不变）

## 明确不包含

- 精选课程目录；
- Starfall、Code.org 或其他第三方课程网页入口；
- 课程内嵌浏览器；
- 课程资料采集与课程来源归因；
- 课程启用、隐藏、排序、年级或学生分配；
- 课程许可证、目录签名、公钥、封面素材或自选课程 Excel。

## Git 恢复点

- 分支：`milestone/windows-0.14.10-pre-course`
- 注释标签：`v0.14.10`
- 基础提交：`e231358bc05bc626cb69b87cf14b2597ccd5f71d`（Windows `0.14.9` 受控正式发布）

回滚或派生新开发线：

```powershell
git fetch origin --tags
git switch -c <新分支名> v0.14.10
```

不要从未提交的课程开发工作区复制文件到本里程碑分支。课程功能应使用 `0.15.1+` 开发线。

## 发布边界

本里程碑用于代码回滚、问题复现和派生开发。它继承 `0.14.9` 的已知发布边界：Windows Authenticode 尚未签名，Android 使用项目调试证书，延期真机门禁仍未补做，因此不因“里程碑”名称自动升级为完成全部公开门禁的稳定版。

## 自动验证与构建

- 全量自动测试：`549/549` 通过；
- P6 固定资料十场景：`10/10` 通过；
- Windows 主机生产构建、包内资源审计：通过；
- Windows 学生端生产构建、启动依赖审计：通过；
- 两个 Windows EXE 的 `ProductVersion` 均为 `0.14.10`，`CompanyName` 均为 `Robogala`；
- 两个 Windows EXE 的 Authenticode 状态均为 `NotSigned`。

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `AI-edu-manager-console-Windows-0.14.10.exe` | 89662860 | `C1F279497C7C4FBC5B8FF18FDF35FE2A9E92F64119DFD5CBD6E71A1DEB8594A4` |
| `AI-edu-manager-console-Windows-0.14.10.zip` | 89670746 | `9800FBDFA5CC5EFC5A93CABD25AC3C32E329C02099171E74C16CB7CEA62FC8D0` |
| `AI-edu-manager-student-terminal-Windows-0.14.10.exe` | 87481850 | `CC8FB86AFDB31B231901B4E6774C8C5779558006CD7BD818A78341487CF2E8D6` |
