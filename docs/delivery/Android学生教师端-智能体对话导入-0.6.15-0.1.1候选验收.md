# Android 学生端 / 教师端智能体对话导入候选验收

日期：2026-08-29

版本：Android 学生端 0.6.15（versionCode 85）/ Android 教师端 0.1.1（versionCode 2）

配套主机：Windows 主机端 0.16.8，不修改主机协议和安装包。

## 交付范围

- 在两个 Android 端现有“资料搜集上传”中增加一个“导入智能体对话”入口。
- 接收 Android `ACTION_SEND` 的 `EXTRA_TEXT` 纯文本；普通 URI 文件分享继续沿用原上传流程。
- 支持从剪贴板粘贴正文；不读取其他应用私有聊天数据库，不自动登录或抓取分享链接。
- 学生端固定当前学生；教师端复用已有学生检索和选择。两端均默认学生教育档案，关联项目为可选项。
- Android 端不拆分或改写说话人，把用户明确分享的原始正文作为一条不可变消息提交。
- 复用 `POST /api/agent/conversation/submit`，不使用普通 materials 接口承载对话。
- 同一设备、正文和目标生成稳定幂等键；显示已存入、已存在、待主机确认或失败回执。
- 网络失败只保留一份本地草稿并允许手动重试；没有引入后台队列、附件、文件解析或超长对话自动拆分。

## 源码与协议门禁

- Android 端正文上限为 60000 字；只有单个 HTTP/HTTPS 链接时拒绝导入并提示粘贴正文。
- 项目目标来自 `projectsForSelectedStudent()`；发送前再次检查学生和项目关系，学生切换后旧目标不能继续提交。
- 学生端使用当前学生会话 token，教师端使用教师设备 token；主机继续执行现有 Bearer 鉴权和学生/项目权限校验。
- 主机回执中的 `stored`、`deduplicated`、`awaiting_attribution` 被翻译为面向用户的简短结果。

## 构建证据

| 客户端 | APK | 大小 | SHA-256 | 签名验证 |
| --- | --- | ---: | --- | --- |
| Android 学生端 | `release/tablet-terminal/AI-edu-manager-tablet-terminal-0.6.15.apk` | 1,819,624 字节 | `8E33ADCCCC1F9C9BC636A3EEDF063DB3550B23BE21D6A642A35A2E092A284BE6` | v1/v2/v3 通过 |
| Android 教师端 | `release/teacher-terminal/AI-edu-manager-teacher-terminal-0.1.1.apk` | 1,819,705 字节 | `53599B3F08B71A2E11D28E03A45F49BA7A9D5B3B7D09450B6FC49BB6CC2D2F56` | v1/v2/v3 通过 |

构建命令：

```powershell
powershell -ExecutionPolicy Bypass -File android-tablet-terminal\build.ps1
powershell -ExecutionPolicy Bypass -File android-teacher-terminal\build.ps1
```

两个 APK 均由当前仓库构建脚本的稳定候选密钥签名。签名结构校验通过不等于长期产品证书发布验收；正式发布前仍须按发布制度核对既有安装包证书连续性。

## 自动化验证

聚焦验证包括：

- Android 对话导入入口、纯文本分享、原文提交、目标约束、草稿和回执契约；
- 主机对话规范化、幂等、附件边界、归属和候选知识治理；
- 教师端独立包名、教师角色、全学生范围、模块精简与独立更新通道；
- 学生端既有升级迁移契约；
- 下载页、安装包链接及 Android 操作手册。

全量命令 `pnpm test` 结果：867 项，其中 866 项通过、1 项按既有条件跳过、0 项失败。

## 尚未替代的真机门禁

源码测试、APK 构建和签名校验不等于真机用户验收。正式发布前仍需在至少一台学生设备和一台教师设备上验证：

1. 从真实智能体应用分享正文；
2. 只有链接时的提示；
3. 学生档案和关联项目各一次实际入库；
4. 相同正文重复发送的去重回执；
5. 断网失败后重连重试；
6. 教师切换学生后目标不串档；
7. Windows 主机端对应档案或项目资料库能够回读新对话。

真机证据未记录前，本文件状态为“候选验收”，不得写成“正式发布”或“真机通过”。

本轮执行 `adb devices -l` 时没有发现已连接设备，因此没有生成或伪造真机结果。
