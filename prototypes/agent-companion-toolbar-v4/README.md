# Agent伴侣工具条 V4 Demo

这是一个独立、无真实数据连接的交互原型，用于确认新版工具条的布局、层级和关键状态。它不修改生产工具条、Electron主进程、提示词服务或应用版本。

## 设计方向

- 定位：覆盖在任意桌面端或网页端Agent旁边的轻量学习控制器。
- 风格：紧凑学习仪表条；深绿仅强调当前学习入口和确认动作。
- 标志性设计：资料范围胶囊与能力分级Agent菜单，让用户始终知道“本次基于什么资料、提示词准备交给谁”。
- 安全边界：Demo中的复制、采集、连接和归档均为模拟，不读取本机资料，不连接真实Agent。

## 五个场景

直接双击 `index.html`，或通过顶部场景按钮切换：

1. 收起态：54px单行工具条。
2. 学习行：96px双行工具条，高频学习动作保持一键可达。
3. Agent菜单：展示通用、已验证和自定义Agent的能力差异。
4. 学习模式：展示模拟学习分组和项目答辩轻配置。
5. 窄屏态：按钮退化为图标，保持采集与学习主路径。

也可以使用查询参数直接打开截图状态：

```text
index.html?scene=collapsed&capture=1
index.html?scene=expanded&capture=1
index.html?scene=agent&capture=1
index.html?scene=learning&capture=1
index.html?scene=compact&capture=1
```

## 按钮说明

| 区域 | 按钮 | Demo行为 | 正式实现预期 |
| --- | --- | --- | --- |
| 身份 | 当前学生 | 展示当前学生 | 切换学生并使旧提示词失效 |
| 环境 | 目标Agent | 切换通用、已验证或自定义Agent | 控制提示词格式与真实能力范围 |
| 采集 | 截屏、录音、拍照、会话、收件箱 | 显示模拟状态 | 复用现有采集能力 |
| 学习 | 消化、闪卡、测验、导图 | 复制示例提示词 | 生成学生与资料范围绑定的版本化提示词 |
| 模式 | 学习模式 | 打开学习、模拟、核验、记录面板 | 轻配置后复制到当前Agent |
| 持久化 | 归档 | 显示确认提示 | 选择成果和目标后受控归档 |
| 连接 | AI设置 | 复制通用或Agent专用协作指令 | 已验证Agent复用完整连接指令 |

## 视觉参数

- 收起高度：54px。
- 展开高度：96px。
- 推荐宽度：820px。
- 窄屏演示宽度：620px。
- 普通按钮：30–32px。
- 无外部字体、图片、图标库或网络请求。
- 支持键盘焦点、Esc关闭浮层和 `prefers-reduced-motion`。

## 截图

五张验收截图位于 `screenshots/`：

- `agent-companion-toolbar-v4-collapsed.png`
- `agent-companion-toolbar-v4-expanded.png`
- `agent-companion-toolbar-v4-agent-menu.png`
- `agent-companion-toolbar-v4-learning-mode.png`
- `agent-companion-toolbar-v4-compact.png`

