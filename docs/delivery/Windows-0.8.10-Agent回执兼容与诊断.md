# Windows 0.8.10：Agent 回执兼容与诊断

## 发布内容

- Agent JSON 回执兼容 UTF-8 BOM。
- 项目消化回执错误会明确显示缺失或不匹配的 `projectId`、`digestBatchId` 和 `digestedFiles`。
- 识别并提示旧格式 `batchId`、`processedFiles`，不再把格式错误笼统显示为“尚未检测到”。
- Agent 指令要求逐字复制当前请求身份，并按冻结源文件逐项回写 `relativePath + sha1`。
- 允许有效的部分完成回执，只确认实际完成文件，其余资料继续待处理。

## 兼容性

- Android 平板终端保持 0.5.8。
- 不修改现有项目请求、回执或知识文件。
- 不放宽项目 ID、批次 ID、相对路径和 SHA-1 的严格校验。

## 验证

- 自动测试：119/119 通过。
- Windows EXE SHA-256：`20BBD6B9D39360446ED2B2BD43B938C3357799C0D9946BA8D20FA4A75F2F8FE1`。
- Windows ZIP SHA-256：`4CA4D8F8869243931D80D91BB1D28C853A7F86C3EDE377DBF5A9E31355A26FC7`。
