# AI Education Manager

**English** | [简体中文](README.zh-CN.md)

AI Education Manager helps families, students and educators collect learning materials, maintain student portfolios and organize project knowledge. A Windows host coordinates student and teacher clients. Android standalone runs independently on a phone or tablet. Users can connect supported AI agents to help organize and analyze authorized material.

[Official website](https://education.robogala.com) · [English downloads](https://www.greatbg.com/education/download-en.html) · [中文下载](https://www.greatbg.com/education/download.html) · [Version manifest](https://www.greatbg.com/download/edu-manager-version.json) · [Release notes](https://github.com/LibraranMTL/ai-edu-manager-console/releases)

## Editions and current releases

| Edition | Current stable version | Purpose |
| --- | --- | --- |
| Windows host | **0.24.5** | Manage students, materials, projects, agents, reports and connected clients |
| Windows student | **0.19.3** | Collect learning material and use the student workspace with a host |
| Android student | **0.6.34** | Upload or share learning material and view content provided by the host |
| Android teacher | **0.1.5** | Select a student and project, collect material and view host records |
| Android standalone | **1.3.9** | Run a full student knowledge workspace directly on an Android device |

The editions have independent version numbers. The download center provides the current packages and previous versions where available. Windows packages are currently unsigned. Verify the source and published checksum before installing.

## Features

### Student records and learning

- Create or take over student records and organize source material by student. Track learning events, learning resources, knowledge points, growth models and reports with their supporting evidence.
- Use learning cards and learning actions, browse selected courses and review published educational records. Windows focus mode provides configurable application and web rules.
- Generate and export supported reports and education content for review and communication.

### Material collection and smart inbox

- Import files and collect photos, screen captures, recordings and AI conversations. Automatic conversation capture operates within configured user authorization.
- Connect material sources to the inbox. The system checks student and project scope, reuses verified classification results, and automatically delivers eligible items with receipts. Ambiguous ownership remains available for review.
- Retry recoverable extraction, classification and delivery checks. Confirmed internal tasks and genuinely empty material can be recycled under the configured retention policy. Original files and valid evidence are retained.

### Projects, knowledge and agents

- Organize project material, project knowledge, milestones, topic ideas and research. Link students to projects and review related reports and outcomes.
- Connect supported agents such as WorkBuddy or Codex through the host's controlled integration. Agent availability, authentication and dispatch readiness are distinct checks.
- Use authorized knowledge collaboration between trusted nodes and review the scope before sharing or publishing records.

### Multi-device and standalone use

- Pair student and teacher clients with the Windows host. Student access follows the configured student scope. Teachers select a student and an authorized project when collecting material.
- Android standalone maintains a local workspace, supports material collection, OCR, selected courses, student records, projects, backups and online self-service activation.

## Installation and first use

### Windows host

1. Download the **Windows host installer** from the [English download page](https://www.greatbg.com/education/download-en.html). A portable EXE and ZIP are also available. Close an older host and back up its state before upgrading.
2. Run the installer and start AI Education Manager. The program is not Authenticode-signed. Check its origin and compare the file checksum with the [version manifest](https://www.greatbg.com/download/edu-manager-version.json).
3. In **System Settings → Basic Settings → License**, enter a purchased activation code and activate online. Existing device-code licenses and license-file import remain available. An existing activation can be recovered on the same device.
4. Create or connect a student record and select the storage location. Configure and authorize a supported agent if you want agent-assisted processing.
5. Add approved sources in the material inbox, review source and student scope, and enable automatic processing as appropriate. Use the task and inbox views to check progress, receipts and items requiring a decision.

[Windows host manual (Chinese)](https://www.greatbg.com/education/windows-host-manual.html)

### Student and teacher clients

1. Install the relevant Windows student, Android student or Android teacher package from the download center.
2. Start the Windows host and its client service. Connect the device using the pairing instructions in the applicable manual.
3. On a student client, establish the intended student session before uploading or viewing records. On the teacher client, select the student and permitted project before uploading.

[Windows student manual](https://www.greatbg.com/education/windows-student-manual.html) · [Android student manual](https://www.greatbg.com/education/android-student-manual.html) · [Android teacher manual](https://www.greatbg.com/education/android-teacher-manual.html) (Chinese)

### Android standalone

1. Download and install the signed Android standalone APK. Before upgrading, create an encrypted backup. An existing release signed with the same certificate can be updated in place.
2. On first launch, connect to the internet and enter or scan a purchased activation code. Existing device-code authorization is also supported.
3. Select and authorize a persistent local directory, then create or connect a student record. Configure an available supported agent when needed.

[Android standalone manual (Chinese)](https://www.greatbg.com/education/android-standalone-manual.html)

## Development

The Windows host is an Electron and Vite application. From the repository root, install dependencies and start the development server:

```powershell
pnpm install
pnpm dev
```

Run `pnpm typecheck` and `pnpm test:windows` for the Windows checks. Release and platform-specific builds have additional packaging and acceptance requirements. Android teacher build instructions are in [android-teacher-terminal](android-teacher-terminal/README.md). See [CHANGELOG.md](CHANGELOG.md) for historical changes.

## Development and maintenance

Bao Xiaowen · Shuyuan Bao · Shu Yuan Robert Zhao · Shuyang Bao · Lily Zhao
