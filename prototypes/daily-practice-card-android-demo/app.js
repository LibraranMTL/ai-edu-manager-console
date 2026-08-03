const screens = [...document.querySelectorAll('[data-screen]')];
const navButtons = [...document.querySelectorAll('[data-nav]')];
const answerButtons = [...document.querySelectorAll('[data-answer]')];
const submitAnswer = document.querySelector('#submitAnswer');
const answerMessage = document.querySelector('#answerMessage');
const evidenceSheet = document.querySelector('#evidenceSheet');
const downloadSheet = document.querySelector('#downloadSheet');
const sheetBackdrop = document.querySelector('#sheetBackdrop');
const toast = document.querySelector('#toast');
let selectedAnswer = '';
let monochromeOutput = false;
let toastTimer;

function showScreen(name) {
  screens.forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === name));
  navButtons.forEach((button) => button.classList.toggle('active', button.dataset.nav === (name === 'success' ? 'practice' : name)));
  document.querySelector('#bottomNav').hidden = name === 'success';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function openEvidence() {
  sheetBackdrop.hidden = false;
  evidenceSheet.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => evidenceSheet.classList.add('open'));
}

function openDownload() {
  sheetBackdrop.hidden = false;
  downloadSheet.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => downloadSheet.classList.add('open'));
}

function closeSheets() {
  evidenceSheet.classList.remove('open');
  evidenceSheet.setAttribute('aria-hidden', 'true');
  downloadSheet.classList.remove('open');
  downloadSheet.setAttribute('aria-hidden', 'true');
  setTimeout(() => { sheetBackdrop.hidden = true; }, 280);
}

document.querySelector('#startPractice').addEventListener('click', () => showScreen('practice'));
document.querySelector('#backHome').addEventListener('click', () => showScreen('home'));
document.querySelector('#finishPractice').addEventListener('click', () => {
  showScreen('home');
  showToast('今日练习已记录到你的教育档案');
});

navButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.nav === 'practice') showScreen('practice');
    else showScreen(button.dataset.nav);
  });
});

answerButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectedAnswer = button.dataset.answer;
    answerButtons.forEach((item) => item.classList.remove('selected', 'wrong'));
    button.classList.add(selectedAnswer === 'correct' ? 'selected' : 'wrong');
    submitAnswer.disabled = false;
    answerMessage.className = `answer-message ${selectedAnswer}`;
    if (selectedAnswer === 'correct') {
      answerMessage.innerHTML = '<strong>判断正确</strong><span>“科技书是故事书的 3/4”，所以故事书是单位“1”。</span>';
      submitAnswer.textContent = '确认答案';
    } else {
      answerMessage.innerHTML = '<strong>再想一步</strong><span>找到“的”字后面的量：科技书是故事书的 3/4。</span>';
      submitAnswer.textContent = '重新选择';
    }
  });
});

submitAnswer.addEventListener('click', () => {
  if (selectedAnswer !== 'correct') {
    showToast('看看提示，再选择一次');
    return;
  }
  showScreen('success');
});

document.querySelectorAll('#openEvidence, #openEvidenceFromQuestion').forEach((button) => button.addEventListener('click', openEvidence));
document.querySelector('#openDownload').addEventListener('click', openDownload);
document.querySelector('#closeEvidence').addEventListener('click', closeSheets);
document.querySelector('#closeDownload').addEventListener('click', closeSheets);
sheetBackdrop.addEventListener('click', closeSheets);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSheets(); });
document.querySelectorAll('[data-download-format]').forEach((button) => {
  button.addEventListener('click', () => {
    const isPdf = button.dataset.downloadFormat === 'pdf';
    const styleName = monochromeOutput ? '黑白' : '彩色';
    closeSheets();
    setTimeout(() => showToast(isPdf ? `${styleName} PDF 已生成，已保存到下载目录` : `${styleName}高清图片已保存到相册`), 300);
  });
});

document.querySelector('#monochromePrint').addEventListener('change', (event) => {
  monochromeOutput = event.target.checked;
  document.querySelector('.today-card').classList.toggle('print-monochrome', monochromeOutput);
  document.querySelector('#downloadStyleLabel').textContent = monochromeOutput ? '黑白高对比版式' : '彩色版式';
  document.querySelector('#imageFormatHint').textContent = monochromeOutput
    ? '黑白 PNG · 适合普通打印机与热敏打印'
    : '彩色 PNG · 适合保存到相册或发送给老师';
  document.querySelector('#pdfFormatHint').textContent = monochromeOutput
    ? '黑白 A4 · 去除底色，节省打印耗材'
    : '彩色 A4 · 适合打印或长期保存';
});

document.querySelector('.student-button').addEventListener('click', () => showToast('当前学生：林小满 · STU-2026-0051'));
document.querySelectorAll('.feeling-block button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.feeling-block button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});
