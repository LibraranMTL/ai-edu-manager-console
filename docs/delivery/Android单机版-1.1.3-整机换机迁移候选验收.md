# Android 单机版 1.1.3 整机换机迁移候选验收

日期：2026-08-10

基线：Windows 主机端 0.16.8、Android 学生端 0.6.14、Android 单机版 1.1.3（包含未发布的知识协作候选）

## 已实现范围

- 保留学生端“从 Windows 主机升级到单机版（少量资料）”；1000 个文件或 3 GB 以上继续引导 Windows 主机 U 盘精确学生迁移。
- Android 单机版增加整机导出到 U 盘目录，以及新 Android 单机版从 U 盘恢复并接管。
- 迁移全部学生根、项目根和应用私有业务状态；保留业务 ID，目标 URI 和逻辑路径按新平板目录重映射。
- 目录清单与载荷使用 SHA-256；前台服务支持断点续传，每 10 个文件持久化一次进度。
- 新平板导入前强制检查：产品已激活、学生席位足够、应用没有学生/项目、目标目录为空、来源版本不高于本机。
- 状态提交前保留本机快照，失败时回滚私有业务状态；全部完成后才切换默认资料根目录并写入迁移报告。
- 迁移界面皮肤、页面布局和 Agent 公共接口/模型参数；不迁移 Agent API Key。

## 明确排除

- License、设备码、Agent API Key、Android Keystore、SAF 授权、录屏授权；
- 缓存、旧迁移日志、知识协作设备绑定；
- 两套已有家庭资料库合并；
- Android—Android 实时同步。

## 自动验证

- `node --test tests/android-standalone-device-migration-contract.test.cjs tests/android-standalone-w16-contract.test.cjs`：11/11 通过。
- `pnpm test`：817/817 通过；`pnpm build`：Windows 生产前端构建通过。
- `android-standalone-manager/build.ps1 -Task check`：Debug/Release Kotlin 与 Java 编译、Debug/Release 单元测试和 Android Lint 通过。
- Android 学生端 0.6.14 APK 构建通过，v1/v2/v3 校验通过，SHA-256 `2A17CA6A977D4D6803AA2884CAB406E3ECF89EE57CBA51075ECCBD438AA0F427`。
- Android 单机版 1.1.3 正式签名包已生成：SHA-256 `1F87751B641778B6C2A7B25A3217E1E6BB1274A52AB47E024D94B241FAE26C1B`，产品证书 SHA-256 `647087C196380BED06FF285A95B29617DC5A31C4977A0C04DDBA895ADC67164F`，v1/v2 签名校验通过；双平板/U 盘真机验收仍待执行。

## 必须执行的双平板真机验收

1. 旧平板准备至少 1000 张照片、两个学生、一个关联项目、平台/机构课程、对话历史、成长记录和正式学情报告。
2. 导出到真实 U 盘；在 10%–50% 进度时强制结束应用或拔出 U 盘，重新连接后确认“继续上次整机迁移”不会重复或漏文件。
3. 新平板使用独立激活码，先验证席位不足会停止，再更换足够席位激活码。
4. 导入到空目录，验证学生/项目 ID、课程、对话、成长模型、报告与 Markdown 浏览均保持。
5. 核对旧设备 URI 已全部重映射；原平板不受影响。
6. 验证 API Key、录屏授权和知识协作配对没有被带入；重新填写 API Key 后 OCR/视觉/消化连接测试通过。
7. 修改任一 payload 或 manifest，确认导入明确失败且不会把半成品状态设为默认资料库。
8. 完成后重启新平板，确认档案、项目和迁移报告仍可打开。

正式签名包已经生成；未完成上述双平板真机验收前，不宣称“整机迁移已完成目标硬件验收”。
