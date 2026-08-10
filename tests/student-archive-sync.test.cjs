const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  STUDENT_ARCHIVE_SYNC_SCHEMA,
  collectStudentArchiveFiles,
  createStudentArchivePublication,
  filterLocallyAuthoredStudentArchiveFiles,
  materializeStudentArchivePublication,
  recordPublishedStudentArchive,
  splitStudentArchivePublication,
  validateStudentArchivePublication,
  validateStudentArchiveTargetRoots,
} = require('../electron/student-archive-sync.cjs');

test('large student archives split into deterministic direct-transfer batches', () => {
  const publication = {
    schema: STUDENT_ARCHIVE_SYNC_SCHEMA,
    publicationId: 'full-publication',
    lineageId: 'binding-map:student-archive:node-a:student-a|node-b:student-b',
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sourceStudentId: 'student-a',
    targetStudentId: 'student-b',
    fingerprint: 'full-fingerprint',
    entries: Array.from({ length: 5_005 }, (_, index) => ({
      objectId: `object-${index}`,
      revisionId: `revision-${index}`,
      kind: 'confirmed_knowledge',
      relativePath: `knowledge/${index}.md`,
    })),
  };
  const first = splitStudentArchivePublication(publication, 999);
  const second = splitStudentArchivePublication(publication, 999);
  assert.deepEqual(first.map((item) => item.publicationId), second.map((item) => item.publicationId));
  assert.deepEqual(first.map((item) => item.entries.length), [999, 999, 999, 999, 999, 10]);
  assert.equal(first.every((item) => item.collectionFingerprint === publication.fingerprint), true);
  assert.equal(first.every((item) => item.batchCount === 6), true);
});

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'student-archive-sync-'));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function hash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('student archive collection includes governed outputs and excludes original materials', () => {
  const root = tempRoot();
  const knowledge = path.join(root, 'summary');
  const raw = path.join(root, 'raw');
  const growth = path.join(root, 'growth');
  const reports = path.join(knowledge, '学情报告');
  const archive = path.join(root, '.edu-manager', 'education-archive-versions');
  const version = path.join(archive, 'v1');
  write(path.join(knowledge, '概念库', '数学.md'), '已确认知识');
  write(path.join(raw, '课堂照片.jpg'), 'raw');
  write(path.join(growth, 'growth-index.json'), '{"confirmed":1}');
  write(path.join(growth, '成长证据草稿.md'), '候选内容');
  write(path.join(reports, '整体画像.md'), '---\nstatus: published\n---\n报告');
  write(path.join(reports, '待审核.md'), '---\nstatus: pending_review\n---\n候选报告');
  write(path.join(version, '教育档案.md'), '完整档案');
  write(path.join(archive, 'latest.json'), JSON.stringify({ versionDir: version }));

  const files = collectStudentArchiveFiles({
    knowledgeRoot: knowledge,
    rawRoot: raw,
    growthRoot: growth,
    reportRoot: reports,
    archiveRoot: archive,
  });

  assert.deepEqual(new Set(files.map((item) => item.kind)), new Set([
    'confirmed_knowledge',
    'growth_model',
    'learning_report',
    'education_archive',
  ]));
  assert.equal(files.some((item) => item.sourcePath.startsWith(raw)), false);
  assert.equal(files.filter((item) => item.relativePath === '整体画像.md').length, 1);
  assert.equal(files.some((item) => /草稿|待审核/u.test(item.relativePath)), false);
});

test('student archive publication uses stable objects, immutable revisions and parent links', () => {
  const root = tempRoot();
  const source = write(path.join(root, '概念库', '数学.md'), '第一版');
  const first = createStudentArchivePublication({
    lineageId: 'binding-1:student-archive',
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sourceStudentId: 'student-a',
    targetStudentId: 'student-b',
    files: [{ sourcePath: source, relativePath: '概念库/数学.md', kind: 'confirmed_knowledge' }],
  });
  assert.equal(first.schema, STUDENT_ARCHIVE_SYNC_SCHEMA);
  assert.equal(validateStudentArchivePublication(first, { targetNodeId: 'node-b' }).ok, true);

  const state = recordPublishedStudentArchive({}, first);
  fs.writeFileSync(source, '第二版', 'utf8');
  const second = createStudentArchivePublication({
    lineageId: first.lineageId,
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sourceStudentId: 'student-a',
    targetStudentId: 'student-b',
    state,
    files: [{ sourcePath: source, relativePath: '概念库/数学.md', kind: 'confirmed_knowledge' }],
  });
  assert.equal(second.entries[0].objectId, first.entries[0].objectId);
  assert.deepEqual(second.entries[0].parentRevisionIds, [first.entries[0].revisionId]);
  assert.notEqual(second.entries[0].revisionId, first.entries[0].revisionId);
});

test('student archive import fast-forwards known versions, deduplicates and preserves concurrent branches', () => {
  const root = tempRoot();
  const packageRoot = path.join(root, 'package');
  const contentRoot = path.join(packageRoot, 'content');
  const sourceV1 = write(path.join(contentRoot, 'student-archives', 'pub-1', 'confirmed_knowledge', '概念库', '数学.md'), '第一版');
  const publicationV1 = createStudentArchivePublication({
    publicationId: 'pub-1',
    lineageId: 'lineage-1',
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sourceStudentId: 'student-a',
    targetStudentId: 'student-b',
    files: [{ sourcePath: sourceV1, relativePath: '概念库/数学.md', kind: 'confirmed_knowledge' }],
  });
  const roots = {
    knowledgeRoot: path.join(root, 'student-b', 'summary'),
    growthRoot: path.join(root, 'student-b', 'growth'),
    reportRoot: path.join(root, 'student-b', 'reports'),
    archiveRoot: path.join(root, 'student-b', 'archives'),
  };
  const packageRelativePath = (entry) => `student-archives/${publicationV1.publicationId}/${entry.kind}/${entry.relativePath}`;
  const first = materializeStudentArchivePublication({
    publication: publicationV1,
    targetNodeId: 'node-b',
    packageContentRoot: contentRoot,
    packageRelativePath,
    roots,
    conflictRoot: path.join(root, 'conflicts'),
  });
  assert.equal(first.imported, 1);
  assert.equal(first.conflicts, 0);
  assert.equal(first.state.lineages['lineage-1'].lastSyncedFingerprint, publicationV1.fingerprint);

  const duplicate = materializeStudentArchivePublication({
    publication: publicationV1,
    targetNodeId: 'node-b',
    packageContentRoot: contentRoot,
    packageRelativePath,
    roots,
    conflictRoot: path.join(root, 'conflicts'),
    state: first.state,
  });
  assert.equal(duplicate.duplicates, 1);

  const localTarget = path.join(roots.knowledgeRoot, '概念库', '数学.md');
  fs.writeFileSync(localTarget, '本机并发修改', 'utf8');
  const sourceV2 = write(path.join(contentRoot, 'student-archives', 'pub-2', 'confirmed_knowledge', '概念库', '数学.md'), '远端第二版');
  const publicationV2 = createStudentArchivePublication({
    publicationId: 'pub-2',
    lineageId: 'lineage-1',
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sourceStudentId: 'student-a',
    targetStudentId: 'student-b',
    state: recordPublishedStudentArchive({}, publicationV1),
    files: [{ sourcePath: sourceV2, relativePath: '概念库/数学.md', kind: 'confirmed_knowledge' }],
  });
  const conflict = materializeStudentArchivePublication({
    publication: publicationV2,
    targetNodeId: 'node-b',
    packageContentRoot: contentRoot,
    packageRelativePath: (entry) => `student-archives/pub-2/${entry.kind}/${entry.relativePath}`,
    roots,
    conflictRoot: path.join(root, 'conflicts'),
    state: first.state,
  });
  assert.equal(conflict.conflicts, 1);
  assert.equal(fs.readFileSync(localTarget, 'utf8'), '本机并发修改');
  assert.equal(conflict.state.lineages['lineage-1'].conflicts.length, 1);
});

test('missing previously published objects become non-destructive tombstones', () => {
  const root = tempRoot();
  const source = write(path.join(root, '报告.md'), '报告');
  const first = createStudentArchivePublication({
    lineageId: 'lineage-delete',
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sourceStudentId: 'student-a',
    targetStudentId: 'student-b',
    files: [{ sourcePath: source, relativePath: '报告.md', kind: 'learning_report' }],
  });
  const state = recordPublishedStudentArchive({}, first);
  const next = createStudentArchivePublication({
    lineageId: first.lineageId,
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sourceStudentId: 'student-a',
    targetStudentId: 'student-b',
    state,
    files: [],
  });
  assert.equal(next.entries.length, 1);
  assert.equal(next.entries[0].tombstone, true);
  assert.equal(next.entries[0].size, 0);

  const retained = write(path.join(root, 'receiver', 'reports', '报告.md'), '报告');
  const applied = materializeStudentArchivePublication({
    publication: next,
    targetNodeId: 'node-b',
    packageContentRoot: path.join(root, 'unused-package-content'),
    packageRelativePath: () => '',
    roots: {
      knowledgeRoot: path.join(root, 'receiver', 'knowledge'),
      growthRoot: path.join(root, 'receiver', 'growth'),
      reportRoot: path.dirname(retained),
      archiveRoot: path.join(root, 'receiver', 'archive'),
    },
    conflictRoot: path.join(root, 'receiver', 'conflicts'),
    state,
  });
  assert.equal(applied.tombstones, 1);
  assert.equal(fs.existsSync(retained), true);

  const receiverPublication = createStudentArchivePublication({
    lineageId: first.lineageId,
    sourceNodeId: 'node-b',
    targetNodeId: 'node-a',
    sourceStudentId: 'student-b',
    targetStudentId: 'student-a',
    state: applied.state,
    files: [{ sourcePath: retained, relativePath: '报告.md', kind: 'learning_report' }],
  });
  assert.equal(receiverPublication.entries[0].tombstone, true);
  assert.equal(receiverPublication.entries[0].revisionId, next.entries[0].revisionId);
});

test('unchanged remote revisions are not forwarded to a third collaboration peer', () => {
  const root = tempRoot();
  const source = write(path.join(root, 'knowledge', 'math.md'), 'remote content');
  const sha256 = hash(source);
  const state = {
    lineages: {
      'binding-a-b': {
        objects: {
          remote: {
            kind: 'confirmed_knowledge',
            relativePath: 'math.md',
            sha256,
            sourceNodeId: 'node-a',
            currentRevisionId: `revision:${sha256}`,
            version: 1,
            localManaged: true,
            tombstone: false,
          },
        },
      },
    },
  };
  const remoteOnly = filterLocallyAuthoredStudentArchiveFiles({
    files: [{ sourcePath: source, relativePath: 'math.md', kind: 'confirmed_knowledge' }],
    state,
    localNodeId: 'node-b',
  });
  assert.equal(remoteOnly.length, 0);
  const noEchoPublication = createStudentArchivePublication({
    lineageId: 'binding-a-b',
    sourceNodeId: 'node-b',
    targetNodeId: 'node-a',
    sourceStudentId: 'student-b',
    targetStudentId: 'student-a',
    state,
    files: remoteOnly,
  });
  assert.equal(noEchoPublication.entries.length, 0);

  const priorPeerPublication = createStudentArchivePublication({
    lineageId: 'binding-b-c',
    sourceNodeId: 'node-b',
    targetNodeId: 'node-c',
    sourceStudentId: 'student-b',
    targetStudentId: 'student-c',
    files: [{ sourcePath: source, relativePath: 'math.md', kind: 'confirmed_knowledge', sha256 }],
  });
  const stateWithPriorPeer = recordPublishedStudentArchive(state, priorPeerPublication);
  const suppressedButPresent = createStudentArchivePublication({
    lineageId: 'binding-b-c',
    sourceNodeId: 'node-b',
    targetNodeId: 'node-c',
    sourceStudentId: 'student-b',
    targetStudentId: 'student-c',
    state: stateWithPriorPeer,
    files: remoteOnly,
    presentFiles: [{ sourcePath: source, relativePath: 'math.md', kind: 'confirmed_knowledge', sha256 }],
  });
  assert.equal(suppressedButPresent.entries.length, 0, 'suppressed remote content must not become a deletion');

  stateWithPriorPeer.pathProvenance['confirmed_knowledge\u001fmath.md'] = {
    sourceNodeId: 'node-a',
    origin: 'remote',
    tombstone: true,
    revisionId: 'tombstone:remote-delete',
    sequence: 10,
  };
  const suppressedRemoteDeletion = createStudentArchivePublication({
    lineageId: 'binding-b-c',
    sourceNodeId: 'node-b',
    targetNodeId: 'node-c',
    sourceStudentId: 'student-b',
    targetStudentId: 'student-c',
    state: stateWithPriorPeer,
    files: [],
    presentFiles: [],
  });
  assert.equal(suppressedRemoteDeletion.entries.length, 0, 'a remote deletion must not be forwarded to a third peer');

  const localRecreation = createStudentArchivePublication({
    lineageId: 'binding-b-c',
    sourceNodeId: 'node-b',
    targetNodeId: 'node-c',
    sourceStudentId: 'student-b',
    targetStudentId: 'student-c',
    state: stateWithPriorPeer,
    files: [{ sourcePath: source, relativePath: 'math.md', kind: 'confirmed_knowledge', sha256 }],
  });
  const locallyOwnedAgain = recordPublishedStudentArchive(stateWithPriorPeer, localRecreation);
  const localDeletion = createStudentArchivePublication({
    lineageId: 'binding-b-c',
    sourceNodeId: 'node-b',
    targetNodeId: 'node-c',
    sourceStudentId: 'student-b',
    targetStudentId: 'student-c',
    state: locallyOwnedAgain,
    files: [],
    presentFiles: [],
  });
  assert.equal(localDeletion.entries.length, 1, 'a later local edit restores local deletion authority');
  assert.equal(localDeletion.entries[0].tombstone, true);

  fs.writeFileSync(source, 'locally revised content', 'utf8');
  const locallyRevised = filterLocallyAuthoredStudentArchiveFiles({
    files: [{ sourcePath: source, relativePath: 'math.md', kind: 'confirmed_knowledge' }],
    state,
    localNodeId: 'node-b',
  });
  assert.equal(locallyRevised.length, 1);
});

test('student archive targets may use independent writable roots', () => {
  const root = tempRoot();
  const knowledgeRoot = path.join(root, 'external-wiki');
  fs.mkdirSync(knowledgeRoot, { recursive: true });
  const result = validateStudentArchiveTargetRoots({
    knowledgeRoot,
    growthRoot: path.join(root, 'managed', 'growth'),
    reportRoot: path.join(root, 'different-parent', 'reports'),
    archiveRoot: path.join(root, 'versions'),
  });
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(root, 'managed', 'growth')), true);
  assert.equal(fs.existsSync(path.join(root, 'different-parent', 'reports')), true);
});

test('known unmodified files move to the recoverable trash when a tombstone arrives', () => {
  const root = tempRoot();
  const source = write(path.join(root, 'sender', 'report.md'), 'base');
  const first = createStudentArchivePublication({
    lineageId: 'lineage-trash',
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sourceStudentId: 'student-a',
    targetStudentId: 'student-b',
    files: [{ sourcePath: source, relativePath: 'report.md', kind: 'learning_report' }],
  });
  const state = recordPublishedStudentArchive({}, first);
  const tombstone = createStudentArchivePublication({
    lineageId: first.lineageId,
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sourceStudentId: 'student-a',
    targetStudentId: 'student-b',
    state,
    files: [],
  });
  const local = write(path.join(root, 'receiver', 'reports', 'report.md'), 'base');
  const result = materializeStudentArchivePublication({
    publication: tombstone,
    targetNodeId: 'node-b',
    packageContentRoot: path.join(root, 'unused'),
    packageRelativePath: () => '',
    roots: {
      knowledgeRoot: path.join(root, 'receiver', 'knowledge'),
      growthRoot: path.join(root, 'receiver', 'growth'),
      reportRoot: path.dirname(local),
      archiveRoot: path.join(root, 'receiver', 'archive'),
    },
    conflictRoot: path.join(root, 'receiver', 'conflicts'),
    trashRoot: path.join(root, 'receiver', 'trash'),
    state,
  });
  assert.equal(result.tombstones, 1);
  assert.equal(fs.existsSync(local), false);
  const object = result.state.lineages[first.lineageId].objects[first.entries[0].objectId];
  assert.equal(fs.existsSync(object.trashedPath), true);
  assert.equal(fs.readFileSync(object.trashedPath, 'utf8'), 'base');
});

test('locally modified files survive a remote tombstone as delete conflicts', () => {
  const root = tempRoot();
  const source = write(path.join(root, 'sender', 'report.md'), 'base');
  const first = createStudentArchivePublication({
    lineageId: 'lineage-delete-conflict',
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sourceStudentId: 'student-a',
    targetStudentId: 'student-b',
    files: [{ sourcePath: source, relativePath: 'report.md', kind: 'learning_report' }],
  });
  const state = recordPublishedStudentArchive({}, first);
  const tombstone = createStudentArchivePublication({
    lineageId: first.lineageId,
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    sourceStudentId: 'student-a',
    targetStudentId: 'student-b',
    state,
    files: [],
  });
  const local = write(path.join(root, 'receiver', 'reports', 'report.md'), 'local edit');
  const result = materializeStudentArchivePublication({
    publication: tombstone,
    targetNodeId: 'node-b',
    packageContentRoot: path.join(root, 'unused'),
    packageRelativePath: () => '',
    roots: {
      knowledgeRoot: path.join(root, 'receiver', 'knowledge'),
      growthRoot: path.join(root, 'receiver', 'growth'),
      reportRoot: path.dirname(local),
      archiveRoot: path.join(root, 'receiver', 'archive'),
    },
    conflictRoot: path.join(root, 'receiver', 'conflicts'),
    trashRoot: path.join(root, 'receiver', 'trash'),
    state,
  });
  assert.equal(result.conflicts, 1);
  assert.equal(fs.readFileSync(local, 'utf8'), 'local edit');
  assert.equal(result.state.lineages[first.lineageId].conflicts[0].reason, 'delete_conflict');
});

test('main process wires archive sync into the durable direct channel without raw materials', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(source, /objectType:\s*'student_archive_publication'/);
  assert.match(source, /objectType:\s*'student_archive_asset_revision'/);
  assert.match(source, /queueDirectCollaborationDelivery\(published\)/);
  assert.match(source, /async function handleCollaborationDirectCommit[\s\S]*?const studentArchiveImport = ingestImportedStudentArchives\(\)/);
  assert.match(source, /function createEducationArchiveVersion[\s\S]*?scheduleStudentArchiveSync\(normalized\.id\)/);
  assert.match(source, /collectStudentArchiveFiles\(roots\)/);
  assert.match(source, /function refreshStudentArchiveSyncWatchers\(\)/);
  assert.match(source, /fs\.watch\(target\.root,[\s\S]*?scheduleStudentArchiveSync\(target\.studentId,\s*6_000\)/);
  assert.match(source, /const roots = studentArchiveRoots\(normalized\);[\s\S]*?\[roots\.knowledgeRoot,\s*roots\.growthRoot,\s*roots\.reportRoot,\s*roots\.archiveRoot\]/);
  const watcher = source.slice(source.indexOf('function refreshStudentArchiveSyncWatchers()'), source.indexOf('function startStudentArchiveSyncWatchers()'));
  assert.doesNotMatch(watcher, /\[roots\.knowledgeRoot,\s*roots\.rawRoot/);
  assert.match(source, /suppressStudentArchiveSync\(student\.id\)[\s\S]*?materializeStudentArchivePublication/);
  assert.match(source, /startStudentArchiveSyncWatchers\(\)/);
  assert.match(source, /stopStudentArchiveSyncWatchers\(\)/);
  assert.doesNotMatch(source, /student_archive_(?:publication|asset_revision)'[\s\S]{0,400}raw_material/);
});
