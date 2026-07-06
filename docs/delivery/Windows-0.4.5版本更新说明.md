# AI教育管家 Windows 主机控制台 0.4.5 版本更新说明

发布日期：2026-07-06

发布类型：功能版本

适用端：

- Windows 主机控制台：0.4.5
- 平板终端：0.4.3，未改动

## 发布文件

Windows 主机控制台：

```text
AI-edu-manager-console-Windows-0.4.5.exe
```

更新清单：

```text
edu-manager-version.json
```

正式下载清单地址：

```text
https://www.greatbg.com/download/edu-manager-version.json
```

## 更新摘要

- 新增“接管已有知识库 + 绑定已有 Agent 工具”能力。
- 支持“标准知识库”和“接管知识库”并存，不迁移、不移动、不删除已有文件。
- Agent 工具新增 OpenClaw，并补齐安装检测、打开状态、打开按钮和下载入口。
- 上传资料、档案浏览、消化指令、Soul 工作规则改为优先使用学生记录中的真实路径。
- 平板终端 0.4.3 不变，仍可通过 Windows 主机 API 上传资料和查看档案。

## 新增功能

### 接管已有知识库

在“初始化教育管家”和“新建教育智能体”中新增创建方式：

```text
创建标准新知识库
接管已有知识库
```

选择“接管已有知识库”后，可登记已有学生知识库目录。控制台会扫描：

- `AGENT.md`
- 原始资料库目录
- 学情分析汇总目录
- 输出结果目录
- `index.md`
- `log.md`

接管时不会移动、复制、删除旧文件。确认接管后，学生记录会保存真实路径，后续操作都使用这些路径。

### 绑定已有 Agent 工具

接管向导支持记录学生当前使用的 Agent 工具：

- QClaw
- Hohu
- Marvis
- OpenClaw

同时支持记录 Agent 类型：

- 子 Agent
- 主对话 / 普通对话

控制台会根据不同工具生成对应的初始化说明、Soul 工作规则和复制内容。

### OpenClaw 支持

Windows 端 Agent 工具新增 OpenClaw：

- 首页 Agent 工具选择增加 OpenClaw
- 系统设置显示 OpenClaw 安装和打开状态
- 支持打开 OpenClaw
- 支持 OpenClaw 子 Agent 初始化提示
- 支持 OpenClaw 的 Soul / Memory 目标文案

## 调整和兼容

- 旧版学生数据会自动按“标准知识库”兼容。
- 标准新知识库仍默认创建在 `D:\学生资料\学生名知识库`。
- 接管知识库可以位于任意本机目录。
- 上传资料不再假设所有学生都在 `D:\学生资料`，而是读取学生记录中的 `rawPath`。
- 查看教育档案不再假设固定目录，而是读取学生记录中的 `summaryPath`。
- 复制消化指令和 Soul 工作规则使用真实 `AGENT.md` 路径。

## 升级建议

建议所有 Windows 主机控制台用户升级到 0.4.5。尤其适合以下场景：

- 已经在 QClaw、Hohu、Marvis 或 OpenClaw 中手动创建过学生知识库
- 不希望迁移或破坏已有目录
- 需要让 Windows 控制台统一管理旧知识库
- 需要测试 OpenClaw 作为教育管家 Agent 工具

## 测试记录

本版本已完成：

- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`
- `pnpm build`
- Windows portable exe 打包

最终发布物：

```text
release\windows\AI-edu-manager-console-Windows-0.4.5.exe
```

## edu-manager-version.json

```json
{
  "versionCode": 55,
  "versionName": "0.4.5",
  "windowsVersionCode": 55,
  "windowsVersionName": "0.4.5",
  "windowsUrl": "https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.4.5.exe",
  "terminalApkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.4.3.apk",
  "tabletTerminalVersionCode": 53,
  "tabletTerminalVersionName": "0.4.3",
  "tabletTerminalApkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.4.3.apk",
  "managerApkUrl": "https://www.greatbg.com/download/edu-manager-android-0.2.3.apk",
  "managerApkVersionCode": 23,
  "managerApkVersionName": "0.2.3",
  "apkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.4.3.apk",
  "notes": "Windows 0.4.5：新增接管已有知识库与绑定已有 Agent 工具能力，支持标准知识库和接管知识库并存；Agent 工具新增 OpenClaw，并同步安装检测、打开状态、初始化指令、Soul 工作规则和资料路径。平板终端 0.4.3 保持不变。"
}
```

---

嘉玛蓝（北京）科技有限公司版权所有
