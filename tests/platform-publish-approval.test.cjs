const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPublishApproval, changeSummary } = require('../electron/platform-publish-approval.cjs');

test('platform publish approval binds confirmation to the exact draft revisions and base catalog', () => {
  const base = { catalogVersion: '2026.08.02.1', courses: [{ courseId: 'platform:one', name: 'One', status: 'active' }] };
  const drafts = [
    { courseId: 'platform:one', draftRevision: 2, course: { name: 'One updated', status: 'active' }, rights: { status: 'confirmed' }, validation: { ok: true } },
    { courseId: 'platform:two', draftRevision: 1, course: { name: 'Two', status: 'active' }, rights: { status: 'confirmed' }, validation: { ok: true } },
  ];
  const preview = changeSummary(drafts, base);
  assert.deepEqual(preview.counts, { added: 1, updated: 1, withdrawn: 0, deleted: 0 });
  assert.match(preview.confirmationCode, /^PUBLISH-[A-F0-9]{8}$/);
  assert.equal(assertPublishApproval(preview, { digest: preview.digest, confirmationCode: preview.confirmationCode }), true);

  const changed = changeSummary([{ ...drafts[0], draftRevision: 3 }, drafts[1]], base);
  assert.notEqual(changed.digest, preview.digest);
  assert.throws(() => assertPublishApproval(changed, { digest: preview.digest, confirmationCode: preview.confirmationCode }), /过期|不一致/);
  const deleted = changeSummary([], base, ['platform:one']);
  assert.equal(deleted.counts.deleted, 1);
  assert.equal(deleted.changes[0].action, 'deleted');
});
