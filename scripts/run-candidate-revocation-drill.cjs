'use strict';

const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.CANDIDATE_LOCAL_BASE_URL || 'http://127.0.0.1:8765';
const serviceRoot = process.env.CANDIDATE_SERVICE_ROOT || '/opt/edu-cloud-documents-candidate/current';
const publicKeyPath = process.env.CLOUD_PUBLIC_CONTENT_PUBLIC_KEY_PATH;
const adminCredential = process.env.CLOUD_REPORT_ADMIN_TOKEN;
const testCourseId = 'platform:revocation-drill-20261106';
const publishReleaseId = 'release:revocation-drill-20261106-01';
const withdrawReleaseId = 'release:revocation-withdraw-20261106-01';

if (!adminCredential) throw new Error('CLOUD_REPORT_ADMIN_TOKEN is required');
if (!publicKeyPath || !fs.existsSync(publicKeyPath)) throw new Error('candidate public key is unavailable');

const { verifySignedObject } = require(path.join(serviceRoot, 'public-content.cjs'));
const publicKey = fs.readFileSync(publicKeyPath, 'utf8');

async function request(route, options = {}, expected = [200]) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  }
  if (!expected.includes(response.status)) {
    throw new Error(`${options.method || 'GET'} ${route} returned ${response.status}: ${body?.error || body?.raw || 'empty response'}`);
  }
  return { status: response.status, body, etag: response.headers.get('etag') || '' };
}

async function adminRequest(token, route, options = {}, expected = [200]) {
  return request(route, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) },
  }, expected);
}

function post(body) {
  return { method: 'POST', body: JSON.stringify(body) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const login = await request('/v1/admin/sessions', post({ credential: adminCredential }), [201]);
  const token = login.body?.sessionToken;
  assert(token, 'admin session token was not returned');

  try {
    const initialManifest = (await request('/v2/public-content/manifest')).body;
    assert(verifySignedObject(initialManifest, publicKey), 'initial manifest signature verification failed');

    const initialRevocations = await request('/v2/public-content/revocations', {}, [200, 404]);
    if (initialRevocations.status === 200) {
      assert(verifySignedObject(initialRevocations.body, publicKey), 'existing revocations signature verification failed');
      if (initialRevocations.body.tombstones.some((item) => item.courseId === testCourseId)) {
        assert(initialManifest.courses.length === 4, 'completed drill did not leave four active courses');
        assert(!initialManifest.courses.some((item) => item.courseId === testCourseId), 'withdrawn fixture remains active');
        process.stdout.write(JSON.stringify({
          ok: true,
          alreadyComplete: true,
          activeCourseCount: initialManifest.courses.length,
          manifestRevision: initialManifest.manifestRevision,
          revocationRevision: initialRevocations.body.revocationRevision,
          testCourseId,
        }));
        return;
      }
    }

    const fixtureAlreadyActive = initialManifest.courses.some((item) => item.courseId === testCourseId);
    const originalCourses = initialManifest.courses.filter((item) => item.courseId !== testCourseId);
    assert(originalCourses.length === 4, `expected four real courses before drill, got ${originalCourses.length}`);

    let fiveCourseRevision = initialManifest.manifestRevision;
    if (!fixtureAlreadyActive) {
      const coverAssetRevisionId = originalCourses[0]?.coverAssetRevisionId;
      assert(coverAssetRevisionId, 'no reusable cover asset found');

      await adminRequest(token, '/v2/admin/courses', post({
        courseId: testCourseId,
        locale: 'en-US',
        title: 'Candidate Revocation Drill Fixture',
        summary: 'Candidate-only fixture for signed revocation acceptance. It is never assigned to a student.',
        provider: 'AI Education Manager QA',
        launchUrl: 'https://example.com/edu-course-revocation-drill',
        allowedHosts: ['example.com'],
        coverAssetRevisionId,
        gradeBands: ['QA'],
        ageRange: '',
        legalNotice: 'Candidate-only automated acceptance fixture.',
        accountRequirement: '',
        defaultEnabled: false,
        offlineOpenTtlSeconds: 900,
        minClientVersions: {},
      }), [201]);

      const candidate = await adminRequest(token, '/v2/admin/releases/validate', post({
        releaseId: publishReleaseId,
        courseIds: [...originalCourses.map((item) => item.courseId), testCourseId],
        audienceKey: 'candidate-revocation-drill',
        audienceRevision: 'candidate-revocation-drill-v1',
        selectionReason: 'candidate-only signed revocation acceptance',
      }));
      assert(candidate.body?.manifest?.courses?.length === 5, 'validated drill release does not contain five courses');
      assert(candidate.body?.manifestSha256, 'validated drill release has no manifest SHA-256');

      const published = await adminRequest(token, '/v2/admin/releases/publish', post({
        releaseId: publishReleaseId,
        expectedManifestSha256: candidate.body.manifestSha256,
      }));
      fiveCourseRevision = published.body.manifestRevision;

      const fiveCourseManifest = (await request('/v2/public-content/manifest')).body;
      assert(verifySignedObject(fiveCourseManifest, publicKey), 'five-course manifest signature verification failed');
      assert(fiveCourseManifest.courses.length === 5, 'published drill manifest does not contain five courses');
      assert(fiveCourseManifest.courses.some((item) => item.courseId === testCourseId), 'published drill fixture is missing');
    }

    const withdrawStartedAt = Date.now();
    const withdrawn = await adminRequest(token, '/v2/admin/releases/emergency-withdraw', post({
      releaseId: withdrawReleaseId,
      courseId: testCourseId,
      reasonCode: 'candidate_acceptance_drill',
      severity: 'high',
      replacementCourseId: '',
    }));

    const revocations = (await request('/v2/public-content/revocations')).body;
    const revocationVisibleMs = Date.now() - withdrawStartedAt;
    assert(verifySignedObject(revocations, publicKey), 'revocations signature verification failed');
    assert(revocations.tombstones.some((item) => item.courseId === testCourseId), 'test tombstone is missing');

    const finalManifest = (await request('/v2/public-content/manifest')).body;
    const finalManifestVisibleMs = Date.now() - withdrawStartedAt;
    assert(verifySignedObject(finalManifest, publicKey), 'final manifest signature verification failed');
    assert(finalManifest.courses.length === 4, `expected four active courses after withdrawal, got ${finalManifest.courses.length}`);
    assert(!finalManifest.courses.some((item) => item.courseId === testCourseId), 'withdrawn fixture remains in final manifest');
    assert(
      JSON.stringify(finalManifest.courses.map((item) => item.courseId).sort()) === JSON.stringify(originalCourses.map((item) => item.courseId).sort()),
      'real course set changed during revocation drill',
    );

    process.stdout.write(JSON.stringify({
      ok: true,
      alreadyComplete: false,
      activeCourseCount: finalManifest.courses.length,
      testCourseId,
      fiveCourseRevision,
      finalManifestRevision: finalManifest.manifestRevision,
      revocationRevision: revocations.revocationRevision,
      withdrawReleaseId: withdrawn.body.releaseId,
      revocationVisibleMs,
      finalManifestVisibleMs,
      signatureVerified: true,
    }));
  } finally {
    if (token) {
      await adminRequest(token, '/v1/admin/sessions/current', { method: 'DELETE' }).catch(() => {});
    }
  }
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
