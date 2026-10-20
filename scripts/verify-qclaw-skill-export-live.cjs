'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSkillLibraryService } = require('../electron/skill-library-service.cjs');

const outputPath = path.resolve(process.argv[2] || path.join(os.tmpdir(), `qclaw-skill-export-${Date.now()}.json`));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-qclaw-export-'));

(async () => {
  try {
    const service = createSkillLibraryService({ userDataDir: path.join(root, 'user-data'), homeDir: os.homedir() });
    const scan = await service.action('scanSources', { providerIds: ['qclaw'] });
    const source = scan.scans[0];
    const candidate = source.candidates.find(item => item.inspectionStatus === 'ready_to_archive');
    if (!candidate) throw Error('QClaw 当前没有可用于导出验收的就绪 Skill');
    const exported = await service.action('archiveDiscovered', { discoveryIds: [candidate.discoveryId] });
    const result = exported.results[0];
    const evidence = {
      schema: 'edu-manager.qclaw-skill-export-acceptance.v1',
      providerId: 'qclaw',
      scannedRoots: source.roots.map(item => ({ sourceKind: item.sourceKind, readOnly: item.readOnly, status: item.status, count: item.count, excluded: item.excluded })),
      discoveredCount: source.candidates.length,
      exported: {
        relativePath: candidate.relativePath,
        skillName: candidate.identity?.name || '',
        treeSha256: candidate.treeSha256,
        status: result.status,
        sourceUnchanged: result.sourceUnchanged === true,
        archivedObjectVerified: Boolean(result.version?.treeSha256 === candidate.treeSha256),
      },
      sourceWritesPerformed: false,
      acceptedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ outputPath, ...evidence }, null, 2));
    if (!evidence.exported.sourceUnchanged || !evidence.exported.archivedObjectVerified) process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
