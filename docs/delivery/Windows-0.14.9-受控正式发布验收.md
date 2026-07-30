# Windows 0.14.9 / Android 0.6.7 受控正式发布验收

> 发布日期：2026-07-30  
> 发布结论：构建与受控分发验收有条件通过  
> 延期项目：0.9.3 原地升级、十分钟首次使用计时、换机恢复真机门禁

## 一、发布范围

- Windows 主机端：`0.14.9`
- Windows 学生端：`0.14.9`
- Android 学生端：`0.6.7`
- Windows 发行者元数据：`Robogala`
- 发布形式：无候选后缀正式文件，供当前受控分发使用

## 二、自动验收

- 全量自动测试：`549/549`
- P6 固定资料十场景：`10/10`
- Windows 主机生产构建：通过
- Windows 主机最小包内审计：通过，`nodeModuleFiles=0`
- Windows 学生端独立构建：通过
- Windows 学生端最小包内审计：通过，`nodeModuleFiles=0`
- Android 编译：通过
- Android 签名校验：v1、v2、v3 通过

## 三、正式发布文件

| 终端 | 文件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| Windows 主机 | `AI-edu-manager-console-Windows-0.14.9.exe` | 89,660,978 | `A20ED0869E7981CAB48079D2F9B74FFB9822BB8618D035490177810EF3952264` |
| Windows 主机压缩包 | `AI-edu-manager-console-Windows-0.14.9.zip` | 89,668,905 | `BD261B12265CD5423331851C7FE6D445428A26D9C5A3ADF2A074858002C6052A` |
| Windows 学生端 | `AI-edu-manager-student-terminal-Windows-0.14.9.exe` | 87,482,036 | `8A53AF861A3A0C7170AB1EA0D2202990FF77FE2D8BFE8AE0DEBAD5CB6436A392` |
| Android 学生端 | `AI-edu-manager-tablet-terminal-0.6.7.apk` | 1,803,240 | `FC8F5D72AA9AD34793491E329ED0716612D8D689DCF5DE896D2DCEEC4935DC69` |

## 四、签名与分发边界

- 两个 Windows EXE 的 `ProductVersion`、`FileVersion` 均为 `0.14.9`，`CompanyName` 为 `Robogala`。
- 两个 Windows EXE 的 Authenticode 实测状态为 `NotSigned`。
- Android APK 使用项目当前的调试签名证书，不是应用商店生产证书。
- 因此本次允许受控分发，但在取得正式代码签名证书和 Android 生产签名证书前，不标记为应用商店或大规模公开分发就绪。

## 五、延期真机门禁

根据产品决定，以下测试延后：

1. 从 Windows `0.9.3` 原地升级至 `0.14.9`；
2. 新用户十分钟内完成初始化、添加资料并形成首次知识更新；
3. 旧主机备份迁移至新主机并恢复学生、项目、档案和未完成队列。

延期不改变本次安装包的构建结果，但意味着本次发布不能表述为已经完成全部稳定版真机门禁。后续完成真机测试后，应在本记录中补充机器、系统版本、操作时间、结果和问题。

## 六、验收结论

当前源码、自动测试、生产构建、包内资源、版本元数据、文件哈希和 Android 签名校验均通过。Windows 正式文件已去除候选后缀并发布到正式目录。

本次验收结论为：**受控正式发布有条件通过**。条件是保留未签名提示、限定受控分发，并在后续补齐三项延期真机门禁。
