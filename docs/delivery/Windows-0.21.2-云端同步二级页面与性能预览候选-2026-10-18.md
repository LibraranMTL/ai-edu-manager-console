# Windows 0.21.2 云端同步二级页面与性能预览候选

日期：2026-10-18  
候选：`cloud-settings-pages-perf-preview-20261018`  
性质：R41冻结后的内部预览，不占用R42—R46正式阶段编号。

## 本轮交付

- 云端同步设置拆为“连接设置与授权”“同步结果”“云端成果收件箱”三个二级页面。
- 上传基础信息与五类学习资料可逐项勾选；基础信息默认选择，姓名为建档必需，健康资料继续独立授权。
- 已开通学生可更新后续上传范围；新主机下载许可沿用当前选择；旧v1上传许可不能隐式升级为v2资料权限。
- 页面改为按二级页读取数据；收件箱只读列表不再同步等待成果恢复，明确点击“核对并刷新成果”才等待核对。
- 云端面板采用延迟加载，主入口JS从815.27 kB降至793.52 kB；新增云端按需JS 22.08 kB、CSS 6.17 kB。

## 验证证据

- 全量自动化测试：2315项，2314通过，1跳过，0失败。
- 最终定向测试：5项全部通过；包含三页结构、按需加载、上传范围、健康隔离和旧v1不提权。
- Playwright组件渲染：宽屏和720px窄屏均通过；初始页仅读取 `settings + status`，进入同步结果后读取 `students + cache + reports`，进入收件箱先调用 `inbox:false`，点击核对后调用 `inbox:true`。
- 生产Vite构建、Electron包体审计、运行时依赖逐字节核对和源码/暂存/包体敏感信息扫描通过，扫描发现均为0。
- 修改前备份：`artifacts/cloud-settings-pages-performance-backup-20261018`。

## 候选文件

- EXE：`release/windows/candidates/cloud-settings-pages-perf-preview-20261018/AI-edu-manager-console-Windows-0.21.2-cloud-settings-pages-perf-preview-20261018.exe`
- EXE SHA-256：`F07FF4B7323361D4EC94521DA4021BD42726F41A793FEE0585F0FA5B5482BC01`
- ZIP SHA-256：`4F96C6F26B72B3C8BBEA3C650C27BD4F9CF4D9B86C3CBF8C92AFC96372BBB34A`
- 构建审计 SHA-256：`11969B5AFF85F7B85CB91F048417CE8359E461A828AF8587CD27F85B79A8F70C`
- Authenticode：`NotSigned`。
- 正式更新清单仍指向Windows 0.21.1 stable，本候选未覆盖正式文件。

## 未完成边界

- 尚未启动此未签名候选，未完成真实Windows设备重启、授权范围保存和卡顿对比。
- 尚未完成生产云端部署、真实旧库迁移、Web/Android消费、异地主机和跨设备断网恢复验收。
- 工作树包含实施前已有的大量未提交变更，构建审计为 `dirty=true`；不能把此候选视为干净基线、签名版或正式发布。
- 本轮未重跑任何结果未知任务，也未改变正式更新清单。
