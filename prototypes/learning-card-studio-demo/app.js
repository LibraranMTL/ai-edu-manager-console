(() => {
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const pageTitles = { studio: '学习卡片', resources: '资源中心', history: '使用记录' };
  let toastTimer = null;
  let generationTimers = [];

  function showToast(message, icon = '✓') {
    const toast = qs('#toast');
    qs('i', toast).textContent = icon;
    qs('span', toast).textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function switchPage(page) {
    qsa('[data-page-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.pagePanel === page));
    qsa('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
    qs('#crumbTitle').textContent = pageTitles[page] || page;
    qs('main').scrollTo({ top: 0, behavior: 'smooth' });
  }

  qsa('[data-page]').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.page)));

  function openModal(id) {
    const modal = qs(`#${id}`);
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => qs('button', modal)?.focus(), 60);
  }

  function closeModal(modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  qsa('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.closest('.modal-backdrop'))));
  qsa('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal(backdrop);
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') qsa('.modal-backdrop.open').forEach(closeModal);
  });

  ['openEvidenceTop', 'openEvidenceRail', 'openEvidenceSide', 'viewRule'].forEach((id) => {
    qs(`#${id}`)?.addEventListener('click', () => openModal('evidenceModal'));
  });

  function runGeneration() {
    generationTimers.forEach(clearTimeout);
    generationTimers = [];
    const steps = qsa('.generate-steps > div');
    const finish = qs('#finishGenerate');
    steps.forEach((step, index) => {
      step.className = index === 0 ? 'active' : '';
      qs('em', step).textContent = index === 0 ? '进行中' : '等待';
    });
    finish.disabled = true;
    finish.textContent = '生成中…';
    openModal('generateModal');

    steps.forEach((step, index) => {
      if (index === 0) return;
      generationTimers.push(setTimeout(() => {
        const previous = steps[index - 1];
        previous.className = 'done';
        qs('em', previous).textContent = '完成';
        step.className = 'active';
        qs('em', step).textContent = '进行中';
      }, index * 640));
    });

    generationTimers.push(setTimeout(() => {
      const last = steps.at(-1);
      last.className = 'done';
      qs('em', last).textContent = '完成';
      finish.disabled = false;
      finish.textContent = '查看新卡片';
    }, steps.length * 640));
  }

  qs('#generateTop').addEventListener('click', runGeneration);
  qs('#finishGenerate').addEventListener('click', () => {
    closeModal(qs('#generateModal'));
    switchPage('studio');
    showToast('今日卡片已生成并保存');
  });

  qsa('[data-mode]').forEach((button) => button.addEventListener('click', () => {
    qsa('[data-mode]').forEach((item) => item.classList.toggle('active', item === button));
    const editing = button.dataset.mode === 'edit';
    qs('#learningSheet').classList.toggle('editing', editing);
    qsa('[data-editable]').forEach((item) => item.contentEditable = editing ? 'true' : 'false');
    showToast(editing ? '可直接修改高亮文字' : '已返回预览模式', editing ? '✎' : '✓');
  }));

  qsa('[data-device]').forEach((button) => button.addEventListener('click', () => {
    qsa('[data-device]').forEach((item) => item.classList.toggle('active', item === button));
    qs('#canvasStage').dataset.device = button.dataset.device;
    if (button.dataset.device === 'mono') {
      qsa('[data-theme]').forEach((item) => item.classList.toggle('active', item.dataset.theme === 'mono'));
      qs('#learningSheet').className = 'learning-sheet theme-mono';
    }
  }));

  qsa('[data-theme]').forEach((button) => button.addEventListener('click', () => {
    const theme = button.dataset.theme;
    qsa('[data-theme]').forEach((item) => item.classList.toggle('active', item === button));
    qs('#learningSheet').className = `learning-sheet theme-${theme}`;
    qs('#canvasStage').dataset.device = theme === 'mono' ? 'mono' : 'a4';
    qsa('[data-device]').forEach((item) => item.classList.toggle('active', item.dataset.device === (theme === 'mono' ? 'mono' : 'a4')));
    showToast(`已切换为“${qs('b', button).textContent}”`);
  }));

  qsa('[data-toggle-target]').forEach((input) => input.addEventListener('change', () => {
    qs(`#${input.dataset.toggleTarget}`).classList.toggle('hidden-block', !input.checked);
    showToast(input.checked ? '已显示内容区块' : '已隐藏内容区块');
  }));

  qsa('[data-answer]').forEach((button) => button.addEventListener('click', () => {
    qsa('[data-answer]').forEach((item) => item.classList.remove('correct', 'wrong'));
    const correct = button.dataset.answer === 'correct';
    button.classList.add(correct ? 'correct' : 'wrong');
    qs('#answerHint').textContent = correct ? 'Correct — this action was in progress at a specific past time.' : 'Try again — look for was / were + verb-ing.';
  }));

  qs('#printCard').addEventListener('click', () => {
    showToast('已打开打印预览；可另存为 PDF');
    setTimeout(() => window.print(), 350);
  });
  qs('#sendCard').addEventListener('click', () => openModal('feedbackModal'));

  qsa('.feedback-options button').forEach((button) => button.addEventListener('click', () => {
    qsa('.feedback-options button').forEach((item) => item.classList.toggle('active', item === button));
  }));

  qsa('.category-row button').forEach((button) => button.addEventListener('click', () => {
    qsa('.category-row button').forEach((item) => item.classList.toggle('active', item === button));
    const filter = button.dataset.filter;
    qsa('.resource-item').forEach((item) => item.hidden = filter !== 'all' && item.dataset.category !== filter);
  }));

  qs('#resourceSearch').addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    qsa('.resource-item').forEach((item) => item.hidden = query && !item.dataset.search.toLowerCase().includes(query) && !item.textContent.toLowerCase().includes(query));
  });

  qsa('.add-resource').forEach((button) => button.addEventListener('click', () => {
    if (button.classList.contains('added') || button.textContent.includes('已添加')) {
      showToast('该资源已在你的模板中');
      return;
    }
    button.classList.add('added');
    button.textContent = '已添加';
    showToast(`“${button.dataset.name}”已添加到模板`);
  }));

  qs('#creatorInfo').addEventListener('click', () => showToast('创作者计划：当前为邀请制，仅开放模板与内容包', 'i'));
  qs('#studentSwitch').addEventListener('click', () => showToast('Demo 仅展示一个虚构学生，避免增加选择流程', 'i'));
})();
