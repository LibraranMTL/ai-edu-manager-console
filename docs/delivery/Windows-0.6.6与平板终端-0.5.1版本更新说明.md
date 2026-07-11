# AI教育管家 Windows 0.6.6 与平板终端 0.5.1 版本更新说明

发布日期：2026-07-11  
发布类型：商业销售版授权强化 / 稳定性收口版  
适用端：

- Windows 主机控制台：0.6.6
- AI教育管家平板终端：0.5.1
- 旧 Android 控制台：0.2.3，仅内部装机和测试使用

## 发布文件

Windows 主机控制台：

```text
AI-edu-manager-console-Windows-0.6.6.zip
```

平板终端：

```text
AI-edu-manager-tablet-terminal-0.5.1.apk
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

- Windows 0.6.6 强化商业授权许可机制，未激活或许可证过期时只允许有限浏览。
- 未激活状态禁止新建、初始化、导入、主机服务、平板绑定、智能体知识写入和数据维护等正式功能。
- 保留首页、系统设置激活入口、已有教育档案和已有学情报告的只读浏览能力，便于客户查看样例和完成激活。
- 平板终端继续跟随 Windows 主机授权，不单独收费；未激活主机不会提供平板绑定和上传协作服务。
- 保留 Windows 0.6.5 的多资料来源目录能力，激活后可继续使用。

## Windows 0.6.6 主要变化

### 商业授权限制

未激活或许可证过期时允许：

- 首页查看
- 系统设置中的许可证激活、版本检查、用户协议和隐私政策
- 已有教育档案只读浏览
- 已有学情报告只读浏览

未激活或许可证过期时禁止：

- 初始化教育管家
- 新建教育智能体
- 接管已有知识库
- 导入本机资料
- 添加、扫描或导入资料来源目录
- 启动主机服务
- 平板扫码配对、设备绑定和 token API 访问
- 上传资料、消化提交、同步消化结果
- 学生资料保存、删除学生、迁移或重命名知识库目录
- Agent 记忆管理、Agent 设定管理、规则文件管理、对话导入等写入功能
- 主机数据备份恢复、API Token 重置、设备授权管理等正式运营功能

### 界面提示

- 左侧受限菜单显示锁定状态。
- 进入受限功能时显示“请先激活许可证”说明。
- 首页和系统设置展示当前授权状态。
- 未激活时，主机服务和平板配对区域显示授权提示，避免客户误以为网络故障。

### 主机服务保护

- 未激活或过期时，不能启动主机服务。
- 已经运行的主机服务在许可证移除后会停止。
- 平板端访问受 token 保护的学生、上传、档案、报告等 API 时，主机会返回授权限制提示。

## 平板终端 0.5.1 说明

平板终端版本本次不变，继续作为客户使用端：

- 连接主机
- 上传资料到主机
- 查看学情档案
- 联系教育管家
- 查看连接状态
- 检查版本更新

平板端不显示初始化、Agent 创建、QClaw/Obsidian 目录配置、授权发码等管理员功能。平板端是否可上传和浏览主机数据，由 Windows 主机授权状态和设备授权范围决定。

## 兼容性说明

Windows：

- 兼容已有标准学生记录。
- 兼容接管已有知识库的学生记录。
- 兼容 QClaw、Hohu、Marvis、OpenClaw、Codex、Claude Code 等工具配置。
- 学生资料根目录仍默认为 `D:\学生资料`。
- 不改变已有学生知识库目录结构。
- 未激活状态下不会删除已有学生数据，只限制正式使用功能。

平板终端：

- 0.5.1 可连接 Windows 0.6.6。
- 已绑定设备正常情况下不需要重新扫码。
- 如果 Windows 主机许可证未激活或已过期，平板上传、学生列表和档案 API 会受限。
- 激活 Windows 主机后，平板重新连接或刷新即可恢复。

## 升级建议

建议准备商业销售或客户交付的 Windows 主机控制台统一升级到 0.6.6。

升级前建议：

- 备份主机数据。
- 另行备份完整学生资料目录，例如 `D:\学生资料`。
- 关闭旧版 Windows 主机控制台。
- 解压新版 zip 并启动新版 exe。
- 进入系统设置确认许可证状态。

## 回归测试记录

已执行：

- `pnpm build`
- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`
- `pnpm exec electron-builder --win portable --x64 --config.electronDist=node_modules/electron/dist`

说明：本机打包时 electron-builder 默认下载通道出现 TLS 断开，最终使用本机 `node_modules/electron/dist` 作为 Electron 分发源完成 Windows portable 包构建。

最终发布物：

```text
release\windows\AI-edu-manager-console-Windows-0.6.6.exe
release\windows\AI-edu-manager-console-Windows-0.6.6.zip
release\tablet-terminal\AI-edu-manager-tablet-terminal-0.5.1.apk
```

## edu-manager-version.json

```json
{
  "versionCode": 61,
  "versionName": "0.5.1",
  "windowsVersionCode": 76,
  "windowsVersionName": "0.6.6",
  "windowsUrl": "https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.6.6.zip",
  "terminalApkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.5.1.apk",
  "tabletTerminalVersionCode": 61,
  "tabletTerminalVersionName": "0.5.1",
  "tabletTerminalApkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.5.1.apk",
  "managerApkUrl": "https://www.greatbg.com/download/edu-manager-android-0.2.3.apk",
  "managerApkVersionCode": 23,
  "managerApkVersionName": "0.2.3",
  "apkUrl": "https://www.greatbg.com/download/AI-edu-manager-tablet-terminal-0.5.1.apk",
  "notes": "Windows 0.6.6：强化商业授权许可机制，未激活或过期时仅允许首页、系统设置和已有档案/报告只读浏览，禁止新建、初始化、导入、主机服务、平板绑定和智能体知识写入；保留 0.6.5 多资料来源目录能力。平板终端 0.5.1：增加上传、待消化、已消化和档案状态显示。"
}
```

---

嘉玛蓝（北京）科技有限公司版权所有
