'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPracticeCards } = require('../electron/practice-cards.cjs');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('student learning card offers camera, image and file answers with private durable drafts', () => {
  const dialog = read('android-shared/src/com/qxmatrix/terminallearning/TerminalLearningDialog.java');
  const activity = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');

  assert.match(dialog, /拍照作答/);
  assert.match(dialog, /选择图片/);
  assert.match(dialog, /选择文件/);
  assert.match(dialog, /拍照 \/ 上传图片或文件/);
  assert.match(dialog, /ScrollView formScroll/);
  assert.match(dialog, /attachmentButton\.setMinHeight\(\(int\) \(48 \*/);
  assert.match(dialog, /practice-answer-drafts/);
  assert.match(dialog, /MAX_PRACTICE_ATTACHMENT_BYTES = 10 \* 1024 \* 1024/);
  assert.match(dialog, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(dialog, /Base64\.encodeToString\(bytes, Base64\.NO_WRAP\)/);
  assert.match(dialog, /allowImageReview/);
  assert.match(dialog, /OCR 与视觉理解/);
  assert.match(dialog, /识别不清时保留原件并提示核对/);
  assert.match(activity, /TerminalLearningDialog\.handleActivityResult\(this, requestCode, resultCode, data\)/);
});

test('student capabilities expose attachment extraction and bounded image review', () => {
  const main = read('electron/main.cjs');
  const cards = read('electron/practice-cards.cjs');
  const feedback = read('electron/practice-feedback.cjs');

  assert.match(main, /practiceAttachments:\s*true/);
  assert.match(main, /practiceVisualReview:\s*true/);
  assert.match(cards, /\['\.png','\.jpg','\.jpeg','\.pdf','\.txt','\.md','\.docx'\]/);
  assert.match(cards, /bytes\.length > 10\*1024\*1024/);
  assert.match(feedback, /extractPracticeAnswer/);
  assert.match(feedback, /images, input:/);
  assert.match(feedback, /图片与本机 OCR 未形成完整一致的识别结果/);
  assert.match(feedback, /masteryConclusion:\s*null/);
});

test('explicit student image answer enters OCR plus visual review and remains non-mastery evidence', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'student-practice-image-'));
  let visualCalls = 0;
  try {
    const generate = async ({ schema, images }) => {
      if (schema.required.includes('judgement')) {
        visualCalls += 1;
        assert.equal(images.length, 1);
        return {
          judgement: 'partial', summary: '已核对图片作答。', correctParts: ['可见步骤'], issues: ['仍需补充'],
          suggestions: ['补充计算过程'], limitations: [], answerQuotes: ['x=2'], readable: true,
          consistent: true, imageTranscript: 'x=2', printedOnly: true,
        };
      }
      if (schema.required.includes('passed')) return { passed: true, languagePassed: true, reason: '通过' };
      return {
        title: '一次方程练习', subject: '数学', knowledgePoint: '一次方程', rationale: '正式报告中的复习依据',
        minutes: 10, prompt: '2x+3=7', hint: '先移项', answer: 'x=2', explanation: '减3再除2', sourceRefs: ['E0'],
      };
    };
    const api = createPracticeCards({
      resolveStudentDir: async id => path.join(temporary, id),
      snapshot: async () => ({ profile: {}, learningSignals: ['正式报告：复习一次方程'], confirmedGrowthSignals: [], sourceIds: ['r1'], inputFingerprint: 'fp' }),
      generate,
      extractAnswer: async () => ({ text: 'x=2', quality: 'complete', warnings: [], extractorVersion: 'test-ocr.v1' }),
    });
    await api.savePlan('student-a', { subject: '数学', range: 'auto', minutes: 10, template: 'clear', focus: '', autoEnabled: false });
    const { card } = await api.generate('student-a');
    await api.start('student-a', card.id);
    const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('test-image')]);
    const submitted = await api.submit('student-a', card.id, {
      attemptId: 'student-image-answer-001',
      attachment: { name: '作答.png', base64: bytes.toString('base64') },
      allowImageReview: true,
      difficulty: 'right', confidence: 3,
    });
    assert.equal(submitted.attempt.allowImageReview, true);
    assert.equal(submitted.attempt.masteryConclusion, null);

    const reviewed = await api.reviewAttempt('student-a', submitted.attempt.attemptId);
    assert.equal(reviewed.status, 'reviewed');
    assert.equal(visualCalls, 1);
    const detail = await api.attemptDetail('student-a', submitted.attempt.attemptId);
    assert.equal(detail.extraction.text, 'x=2');
    assert.equal(detail.reviews[0].source, 'agent');
    assert.equal(detail.reviews[0].qualityPassed, true);
    assert.equal(Object.hasOwn(detail, 'masteryConclusion'), false);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});
