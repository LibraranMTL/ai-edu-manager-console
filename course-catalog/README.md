# 第三方课程目录发布说明

本目录保存课程目录合同、未签名源文件和合规清单。客户安装包只包含签名后的 `public/course-catalog/catalog.json`、目录公钥和封面，不包含签名私钥。

发布者使用独立保管的 RSA 私钥执行：

```powershell
$env:COURSE_CATALOG_PRIVATE_KEY = 'D:\secure\course-catalog-private.pem'
$env:COURSE_CATALOG_PUBLIC_KEY = 'D:\secure\course-catalog-public.pem'
node scripts/sign-course-catalog.cjs
```

课程目录更新失败、签名失败、版本不兼容或包含未知域名时，客户端继续使用本地最后可用目录。普通用户无需编辑 JSON、签名或域名。

专业版和机构版的自选课程不修改本目录，也不伪装成平台签名课程。主机端提供 Excel 模板，用户只填写“课程名称、课程图片、课程简介、课程链接”；系统自动生成 `tenant:` 课程 ID、从 HTTPS 链接提取精确允许域名，并把图片复制到主机用户数据目录。家庭版、试用版和未激活状态不能导入或向学生端下发这些机构自选课程。

商务边界：第三方提供方负责课程内容、账号、收费与服务条款；AI教育管家提供筛选入口、设备、资料治理、知识整理与用户主动采集能力；真人伴学服务如另行购买，应以单独服务范围和人员安排为准。打开网页或采集屏幕资料不代表课程完成、正确率或学情结论。
