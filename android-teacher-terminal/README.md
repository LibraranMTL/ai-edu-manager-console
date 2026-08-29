# AI教育管家教师端

这是与学生端并存安装的独立 Android 教师终端。

- 应用名称：AI教育管家教师端
- 包名：com.qxmatrix.eduteacher
- 版本：0.1.1
- APK 文件名：AI-edu-manager-teacher-terminal-0.1.1.apk
- APK SHA-256：53599B3F08B71A2E11D28E03A45F49BA7A9D5B3B7D09450B6FC49BB6CC2D2F56

## 功能

- 以教师终端角色连接 Windows 主机，一次读取全部学生并按姓名、ID 或年级检索。
- 从文件、图片、相机、Downloads、系统分享或自动投递文件夹收集资料。
- 从智能体应用分享当前对话，或粘贴对话正文；选择学生后默认存入教育档案，关联项目可选。
- 上传到所选学生的原始资料库，或该学生关联项目的原始资料库。
- 查看所选学生教育档案、学情报告、成长模型、关联项目和项目知识。
- 保留按学生及项目隔离的本地档案缓存，断网时仍可查看已缓存内容。
- 保留连接设置、系统设置、连接备份与应用内更新。
- 不包含精选课程、学生空间登录和教育管家对话模块。

教师端使用独立紫红色图标、独立包名、独立偏好与缓存空间，以及独立更新清单字段 `teacherTerminal*`。

0.1.1 的对话导入只接收教师主动分享或粘贴的正文，不读取其他应用私有聊天记录、不抓取分享链接、不推断附件；失败时保留一份本地草稿供重试。

面向教师的安装和操作说明见 `docs/delivery/Android教师终端操作手册.md`；Windows 主机配套要求和交付证据见 `docs/delivery/Windows-0.15.10-教师终端支持升级验收.md`。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File android-teacher-terminal\build.ps1
```
