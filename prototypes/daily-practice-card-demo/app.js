(() => {
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

  const pageTitles = {
    home: '首页',
    today: '今日提分卡',
    schedule: '今日提分卡 / 练习计划',
    history: '今日提分卡 / 自动记录',
    templates: '今日提分卡 / 卡片模板'
  };

  const practicePages = new Set(['today', 'schedule', 'history', 'templates']);

  let activeTheme = 'explore';
  let activeView = 'desktop';
  let selectedFeeling = '正合适';
  let toastTimer = null;

  const viewLabels = {
    desktop: '标准 4:3',
    mobile: '手机竖版',
    long: '长卡片',
    print: 'A4 PDF'
  };

  function showToast(message, icon = '✓') {
    const toast = qs('#toast');
    if (!toast) return;
    qs('i', toast).textContent = icon;
    qs('span', toast).textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function switchPage(pageName) {
    const target = qs(`[data-page-panel="${pageName}"]`);
    if (!target) return;
    qsa('[data-page-panel]').forEach((panel) => panel.classList.toggle('active', panel === target));
    qsa('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === pageName));
    qs('#practiceNavToggle')?.classList.toggle('active', practicePages.has(pageName));
    if (practicePages.has(pageName)) setPracticeNavExpanded(true);
    qs('#pageCrumb').textContent = pageTitles[pageName] || pageName;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setPracticeNavExpanded(expanded) {
    const group = qs('#practiceNavGroup');
    const toggle = qs('#practiceNavToggle');
    if (!group || !toggle) return;
    group.classList.toggle('collapsed', !expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
  }

  qsa('[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const isPracticeParent = button.id === 'practiceNavToggle';
      const currentPage = qs('[data-page-panel].active')?.dataset.pagePanel;
      if (isPracticeParent && practicePages.has(currentPage)) {
        const currentlyExpanded = button.getAttribute('aria-expanded') === 'true';
        switchPage('today');
        setPracticeNavExpanded(!currentlyExpanded);
        return;
      }
      switchPage(button.dataset.page);
    });
  });

  qsa('[data-jump]').forEach((button) => {
    button.addEventListener('click', () => switchPage(button.dataset.jump));
  });

  qsa('[data-inspector]').forEach((button) => {
    button.addEventListener('click', () => {
      const panelName = button.dataset.inspector;
      qsa('[data-inspector]').forEach((item) => item.classList.toggle('active', item === button));
      qsa('[data-inspector-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.inspectorPanel === panelName));
    });
  });

  qsa('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      activeView = view;
      qsa('[data-view]').forEach((item) => item.classList.toggle('active', item === button));
      qs('#previewStage').dataset.view = view;
      updateOutputSummary();
    });
  });

  function updateOutputSummary() {
    const isMonochrome = qs('#monochromeToggle')?.checked;
    const summary = qs('#outputSummary');
    if (summary) summary.textContent = `${viewLabels[activeView] || '标准版式'} · ${isMonochrome ? '黑白简化' : '彩色'}`;
  }

  qs('#monochromeToggle')?.addEventListener('change', (event) => {
    const isMonochrome = event.target.checked;
    qs('#previewStage').dataset.color = isMonochrome ? 'mono' : 'color';
    updateOutputSummary();
    showToast(isMonochrome ? '已启用黑白打印：底色和装饰已简化' : '已恢复彩色卡片');
  });

  qs('#downloadFormat')?.addEventListener('change', (event) => {
    const labels = { png: '下载 PNG', jpg: '下载 JPG', pdf: '下载 PDF' };
    qs('#downloadCard').textContent = labels[event.target.value] || '下载';
  });

  function applyTheme(theme) {
    activeTheme = theme;
    const card = qs('#practiceCard');
    if (card) card.className = `practice-card theme-${theme}`;
    qsa('[data-theme]').forEach((button) => {
      button.classList.toggle('active', button.classList.contains('template-choice') && button.dataset.theme === theme);
      button.classList.toggle('selected', button.classList.contains('template-tile') && button.dataset.theme === theme);
      const action = qs('em', button);
      if (action) action.textContent = button.dataset.theme === theme ? '当前使用' : '使用';
    });
    const themeLabels = { explore: '清新探索', paper: '专注纸张', cosmos: '星际任务', ocean: '海洋探险' };
    const meta = qs('.toolbar-meta > span');
    if (meta) meta.textContent = `${themeLabels[theme] || '专属主题'} · v1`;
  }

  qsa('.template-choice[data-theme], .template-tile[data-theme]').forEach((button) => {
    button.addEventListener('click', () => {
      applyTheme(button.dataset.theme);
      showToast(`已切换为“${qs('strong', button)?.textContent || '新'}”模板`);
    });
  });

  qsa('[data-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      qsa('[data-answer]').forEach((item) => item.classList.remove('correct', 'wrong'));
      const correct = button.dataset.answer === 'correct';
      button.classList.add(correct ? 'correct' : 'wrong');
      const feedback = qs('#answerFeedback');
      if (correct) {
        feedback.textContent = '判断正确！“科技书是故事书的 3/4”，故事书就是单位“1”。';
        feedback.style.color = '#246347';
      } else {
        feedback.textContent = '再看一次“谁的 3/4”：被比较的故事书才是单位“1”。';
        feedback.style.color = '#9f492d';
      }
    });
  });

  function openModal(id) {
    const modal = qs(`#${id}`);
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => qs('button, input, textarea, select', modal)?.focus(), 80);
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (!qs('.modal-backdrop.open')) document.body.style.overflow = '';
  }

  qsa('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.closest('.modal-backdrop')));
  });

  qsa('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeModal(backdrop);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const open = qs('.modal-backdrop.open');
      if (open) closeModal(open);
      const fullscreen = qs('.preview-stage.fullscreen-preview');
      if (fullscreen) fullscreen.classList.remove('fullscreen-preview');
    }
  });

  ['configureApi', 'templateApiSettings'].forEach((id) => {
    qs(`#${id}`)?.addEventListener('click', () => openModal('apiModal'));
  });

  ['generateTheme', 'pageGenerateTheme', 'emptyGenerateTheme'].forEach((id) => {
    qs(`#${id}`)?.addEventListener('click', () => openModal('themeModal'));
  });

  ['openDataSource', 'openEvidence'].forEach((id) => {
    qs(`#${id}`)?.addEventListener('click', () => openModal('evidenceModal'));
  });

  qs('#completeCard')?.addEventListener('click', () => openModal('completionModal'));

  qs('#openAnswer')?.addEventListener('click', () => {
    const feedback = qs('#answerFeedback');
    feedback.textContent = '完整解析：故事书是被比较的总量，48 × 3/4 = 36，所以科技书有36本。';
    feedback.style.color = '#246347';
    qsa('[data-answer]').forEach((item) => item.classList.toggle('correct', item.dataset.answer === 'correct'));
    showToast('已展开完整解析');
  });

  function roundRect(context, x, y, width, height, radius, fill, stroke, lineWidth = 2) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    if (fill) {
      context.fillStyle = fill;
      context.fill();
    }
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = lineWidth;
      context.stroke();
    }
  }

  function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines = 4) {
    const characters = [...text];
    let line = '';
    let lineIndex = 0;
    for (const character of characters) {
      const candidate = line + character;
      if (context.measureText(candidate).width > maxWidth && line) {
        context.fillText(line, x, y + lineIndex * lineHeight);
        line = character;
        lineIndex += 1;
        if (lineIndex >= maxLines) return y + lineIndex * lineHeight;
      } else {
        line = candidate;
      }
    }
    if (lineIndex < maxLines && line) context.fillText(line, x, y + lineIndex * lineHeight);
    return y + (lineIndex + 1) * lineHeight;
  }

  function createCardCanvas() {
    const sizeByView = {
      desktop: [1200, 900],
      mobile: [720, 1280],
      long: [720, 2160],
      print: [1400, 1050]
    };
    const [width, height] = sizeByView[activeView] || sizeByView.desktop;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const monochrome = qs('#monochromeToggle')?.checked;
    const themeColors = {
      explore: { background: '#f5df92', ink: '#173c35', visual: '#78b6aa', accent: '#f47e57' },
      paper: { background: '#fffdf4', ink: '#273730', visual: '#e8ede8', accent: '#17382f' },
      cosmos: { background: '#172c48', ink: '#f1f5f8', visual: '#203b60', accent: '#ef7f5a' },
      ocean: { background: '#dff4f2', ink: '#123d42', visual: '#62b7bf', accent: '#ef8056' }
    };
    const theme = themeColors[activeTheme] || themeColors.explore;
    const background = monochrome ? '#ffffff' : theme.background;
    const ink = monochrome ? '#111111' : theme.ink;
    const border = monochrome ? '#111111' : 'rgba(23,56,47,.22)';
    const panel = monochrome ? '#ffffff' : 'rgba(255,255,255,.88)';
    const visual = monochrome ? '#ffffff' : theme.visual;
    const accent = monochrome ? '#111111' : theme.accent;
    const pad = activeView === 'desktop' || activeView === 'print' ? 58 : 42;

    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    if (monochrome) {
      context.strokeStyle = '#111111';
      context.lineWidth = 4;
      context.strokeRect(2, 2, width - 4, height - 4);
    }

    context.textBaseline = 'top';
    context.fillStyle = ink;
    context.font = '700 22px "Microsoft YaHei", sans-serif';
    roundRect(context, pad, pad, 116, 42, 8, monochrome ? '#ffffff' : '#17382f', monochrome ? '#111111' : null, 3);
    context.fillStyle = monochrome ? '#111111' : '#ffffff';
    context.fillText('DAY 01', pad + 18, pad + 9);
    context.fillStyle = ink;
    context.font = '700 20px "Microsoft YaHei", sans-serif';
    context.fillText('数学 · 分数应用', pad + 138, pad + 10);

    const titleTop = pad + 78;
    context.font = '700 19px "Microsoft YaHei", sans-serif';
    context.fillText('林小满的今日挑战', pad, titleTop);
    context.font = `900 ${activeView === 'desktop' || activeView === 'print' ? 70 : 62}px "Microsoft YaHei", sans-serif`;
    context.fillText('谁是“1”？', pad, titleTop + 32);
    context.font = '400 19px "Microsoft YaHei", sans-serif';
    context.fillText('先找到单位量，应用题就解开一半了。', pad, titleTop + 112);

    const sealX = width - pad - 45;
    const sealY = titleTop + 47;
    context.beginPath();
    context.arc(sealX, sealY, 43, 0, Math.PI * 2);
    context.fillStyle = monochrome ? '#ffffff' : '#17382f';
    context.fill();
    context.strokeStyle = monochrome ? '#111111' : '#17382f';
    context.lineWidth = 3;
    context.stroke();
    context.textAlign = 'center';
    context.fillStyle = monochrome ? '#111111' : '#ffffff';
    context.font = '900 38px "Microsoft YaHei", sans-serif';
    context.fillText('10', sealX, sealY - 28);
    context.font = '700 14px "Microsoft YaHei", sans-serif';
    context.fillText('分钟', sealX, sealY + 12);
    context.textAlign = 'left';

    const vertical = activeView === 'mobile' || activeView === 'long';
    const bodyTop = titleTop + 172;
    const availableWidth = width - pad * 2;
    const questionX = pad;
    const questionY = vertical ? bodyTop + 320 : bodyTop;
    const questionWidth = vertical ? availableWidth : Math.round(availableWidth * .58);
    const questionHeight = vertical ? 430 : 450;
    const visualX = vertical ? pad : pad + questionWidth + 24;
    const visualY = bodyTop;
    const visualWidth = vertical ? availableWidth : availableWidth - questionWidth - 24;
    const visualHeight = vertical ? 288 : 450;

    roundRect(context, questionX, questionY, questionWidth, questionHeight, 22, panel, border, monochrome ? 3 : 2);
    context.fillStyle = ink;
    context.font = '700 17px "Microsoft YaHei", sans-serif';
    context.fillText('01 · 热身想一想', questionX + 28, questionY + 28);
    context.font = '400 22px "Microsoft YaHei", sans-serif';
    drawWrappedText(context, '图书角有 48 本故事书，科技书的数量是故事书的 3/4。', questionX + 28, questionY + 72, questionWidth - 56, 36, 3);
    context.font = '800 25px "Microsoft YaHei", sans-serif';
    context.fillText('这句话里，谁是单位“1”？', questionX + 28, questionY + 170);
    const optionTop = questionY + 225;
    const optionGap = 12;
    const optionWidth = (questionWidth - 56 - optionGap * 2) / 3;
    ['A. 科技书', 'B. 故事书', 'C. 全部图书'].forEach((label, index) => {
      roundRect(context, questionX + 28 + index * (optionWidth + optionGap), optionTop, optionWidth, 62, 10, '#ffffff', monochrome ? '#111111' : '#d9d7ca', monochrome ? 3 : 2);
      context.fillStyle = '#173c35';
      context.font = '700 16px "Microsoft YaHei", sans-serif';
      context.textAlign = 'center';
      context.fillText(label, questionX + 28 + index * (optionWidth + optionGap) + optionWidth / 2, optionTop + 20);
    });
    context.textAlign = 'left';
    context.fillStyle = monochrome ? '#111111' : '#667870';
    context.font = '400 16px "Microsoft YaHei", sans-serif';
    context.fillText('选一个答案，立即看看你的判断。', questionX + 28, questionY + questionHeight - 46);

    roundRect(context, visualX, visualY, visualWidth, visualHeight, 22, visual, border, monochrome ? 3 : 2);
    const planetX = visualX + visualWidth * .38;
    const planetY = visualY + visualHeight * .46;
    const planetRadius = Math.min(visualWidth, visualHeight) * .18;
    context.beginPath();
    context.arc(planetX, planetY, planetRadius, 0, Math.PI * 2);
    context.fillStyle = monochrome ? '#ffffff' : '#f6de8e';
    context.fill();
    context.strokeStyle = monochrome ? '#111111' : 'rgba(23,56,47,.22)';
    context.lineWidth = 3;
    context.stroke();
    context.textAlign = 'center';
    context.fillStyle = '#173c35';
    context.font = '900 46px "Microsoft YaHei", sans-serif';
    context.fillText('48', planetX, planetY - 35);
    context.font = '700 15px "Microsoft YaHei", sans-serif';
    context.fillText('故事书', planetX, planetY + 18);
    const moonX = visualX + visualWidth * .72;
    const moonY = visualY + visualHeight * .31;
    context.beginPath();
    context.arc(moonX, moonY, planetRadius * .62, 0, Math.PI * 2);
    context.fillStyle = monochrome ? '#ffffff' : accent;
    context.fill();
    context.strokeStyle = monochrome ? '#111111' : accent;
    context.stroke();
    context.fillStyle = monochrome ? '#111111' : '#ffffff';
    context.font = '900 28px "Microsoft YaHei", sans-serif';
    context.fillText('¾', moonX, moonY - 22);
    context.font = '700 11px "Microsoft YaHei", sans-serif';
    context.fillText('科技书', moonX, moonY + 12);
    context.fillStyle = monochrome ? '#111111' : '#ffffff';
    context.font = '700 16px "Microsoft YaHei", sans-serif';
    context.fillText('把故事书看作完整的一圈', visualX + visualWidth / 2, visualY + visualHeight - 42);
    context.textAlign = 'left';

    if (activeView === 'long') {
      const extensionTop = questionY + questionHeight + 28;
      const extensionHeight = 300;
      roundRect(context, pad, extensionTop, availableWidth, extensionHeight, 22, panel, border, monochrome ? 3 : 2);
      context.fillStyle = ink;
      context.font = '700 18px "Microsoft YaHei", sans-serif';
      context.fillText('02 · 巩固练一练', pad + 28, extensionTop + 28);
      context.font = '400 22px "Microsoft YaHei", sans-serif';
      drawWrappedText(context, '果园里有 60 棵苹果树，梨树的数量是苹果树的 2/5。这里应把谁看作单位“1”？', pad + 28, extensionTop + 76, availableWidth - 56, 38, 4);
      context.font = '700 18px "Microsoft YaHei", sans-serif';
      context.fillText('我的判断：________________________________', pad + 28, extensionTop + 228);

      const ruleTop = extensionTop + extensionHeight + 28;
      roundRect(context, pad, ruleTop, availableWidth, 260, 22, panel, border, monochrome ? 3 : 2);
      context.font = '700 18px "Microsoft YaHei", sans-serif';
      context.fillText('03 · 写下你的方法', pad + 28, ruleTop + 28);
      context.font = '400 22px "Microsoft YaHei", sans-serif';
      drawWrappedText(context, '看到“谁是谁的几分之几”，先找到“的”字后面的量。', pad + 28, ruleTop + 76, availableWidth - 56, 38, 3);
      context.font = '700 18px "Microsoft YaHei", sans-serif';
      context.fillText('单位“1”是：________________________________', pad + 28, ruleTop + 188);
    }

    context.strokeStyle = monochrome ? '#111111' : 'rgba(23,56,47,.28)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(pad, height - 72);
    context.lineTo(width - pad, height - 72);
    context.stroke();
    context.fillStyle = ink;
    context.globalAlpha = .72;
    context.font = '400 14px "Microsoft YaHei", sans-serif';
    context.fillText('依据：7月学情报告 · 错题类型 M-FRAC-02', pad, height - 48);
    context.textAlign = 'right';
    context.fillText('AI生成 · 学生 STU-2026-0051', width - pad, height - 48);
    context.textAlign = 'left';
    context.globalAlpha = 1;
    return canvas;
  }

  async function downloadCardImage(format) {
    const canvas = createCardCanvas();
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const quality = format === 'jpg' ? 0.94 : undefined;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
    if (!blob) throw new Error('图片编码失败');

    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `今日提分卡-STU-2026-0051-${activeView}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  qs('#downloadCard')?.addEventListener('click', async (event) => {
    const format = qs('#downloadFormat')?.value || 'png';
    if (format === 'pdf') {
      showToast('已打开系统打印预览，可保存为 PDF', '↗');
      window.setTimeout(() => window.print(), 380);
      return;
    }

    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '正在生成…';
    try {
      await downloadCardImage(format);
      showToast(`已下载 ${format.toUpperCase()} 图片`);
    } catch (error) {
      showToast(`图片下载失败：${error.message}`, '!');
    } finally {
      button.disabled = false;
      button.textContent = `下载 ${format.toUpperCase()}`;
    }
  });

  qs('#fullscreenCard')?.addEventListener('click', () => {
    qs('#previewStage')?.classList.toggle('fullscreen-preview');
  });

  qsa('input[name="visualSource"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      qsa('.radio-source').forEach((label) => label.classList.toggle('active', qs('input', label)?.checked));
      if (radio.checked && radio.value === 'api') openModal('apiModal');
    });
  });

  qs('#toggleSecret')?.addEventListener('click', (event) => {
    const input = qs('#apiKeyInput');
    input.type = input.type === 'password' ? 'text' : 'password';
    event.currentTarget.textContent = input.type === 'password' ? '显示' : '隐藏';
  });

  qs('#testApi')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const result = qs('#apiTestResult');
    button.disabled = true;
    button.textContent = '正在测试…';
    result.classList.remove('success');
    qs('strong', result).textContent = '正在连接供应商';
    qs('small', result).textContent = '验证API地址、模型名称和授权状态。';
    window.setTimeout(() => {
      result.classList.add('success');
      qs('strong', result).textContent = '连接成功';
      qs('small', result).textContent = '模型 image-pro-4x3 可用，支持4:3图片输出。';
      button.disabled = false;
      button.textContent = '重新测试';
    }, 1100);
  });

  qs('#saveApi')?.addEventListener('click', () => {
    closeModal(qs('#apiModal'));
    showToast('图片生成API设置已安全保存在本机');
  });

  qs('#supplierLink')?.addEventListener('click', () => {
    showToast('原型：这里将打开特约供应商购买页面', '↗');
  });

  qs('#startThemeGeneration')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const progress = qs('#themeProgress');
    if (button.dataset.generated === 'true') {
      closeModal(qs('#themeModal'));
      showToast('“海洋探险”主题已加入模板库');
      button.dataset.generated = '';
      button.innerHTML = '<span>✦</span> 生成主题';
      progress.classList.remove('done');
      return;
    }
    button.disabled = true;
    progress.classList.remove('done');
    progress.classList.add('running');
    qs('strong', progress).textContent = '正在生成海洋探险主题';
    qs('small', progress).textContent = '仅发送视觉描述，不发送学生学情资料。';
    window.setTimeout(() => {
      progress.classList.remove('running');
      progress.classList.add('done');
      qs('strong', progress).textContent = '主题已生成';
      qs('small', progress).textContent = '已完成文件安全和4:3渲染兼容检查。';
      button.textContent = '使用新主题';
      button.disabled = false;
      button.dataset.generated = 'true';
    }, 1800);
  });

  function runGeneration() {
    const overlay = qs('#generationOverlay');
    const title = qs('#generationTitle');
    const detail = qs('#generationDetail');
    const steps = qsa('.generation-steps span');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    title.textContent = '读取最新学情依据';
    detail.textContent = '只读取林小满的已发布学情报告和教育档案';
    steps.forEach((step, index) => step.classList.toggle('active', index === 0));

    window.setTimeout(() => {
      title.textContent = '本地Agent正在设计练习';
      detail.textContent = '围绕“分数应用题的单位量判断”生成10分钟微练习';
      steps.forEach((step, index) => step.classList.toggle('active', index <= 1));
    }, 1050);

    window.setTimeout(() => {
      title.textContent = '渲染电子卡片与PDF';
      detail.textContent = `正在套用${activeTheme === 'explore' ? '清新探索' : '当前'}模板并进行版式兼容检查`;
      steps.forEach((step) => step.classList.add('active'));
    }, 2050);

    window.setTimeout(() => {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      switchPage('today');
      showToast('今日卡片已生成并进入学生收件箱');
    }, 3150);
  }

  qs('#quickGenerate')?.addEventListener('click', runGeneration);

  qs('#automationToggle')?.addEventListener('change', (event) => {
    if (event.target.checked) {
      updateStrategyPreview();
      showToast('练习计划已恢复，将按当前生成模式执行');
    } else {
      qs('#automationState').textContent = '已暂停';
      showToast('练习计划已暂停，仍可手动生成今日卡片');
    }
  });

  const triggerModeText = {
    smart: {
      state: '学情更新 + 定时兜底',
      timeLabel: '最迟生成时间',
      summary: (time) => `学情更新后生成 · ${time} 定时兜底`,
      toast: '已选择推荐模式：学情更新后生成，固定时间兜底'
    },
    schedule: {
      state: '每日固定时间',
      timeLabel: '固定生成时间',
      summary: (time) => `仅在执行日 ${time} 生成`,
      toast: '已切换为每日固定时间生成'
    },
    manual: {
      state: '仅手动生成',
      timeLabel: '不使用定时',
      summary: () => '仅点击“立即生成今日卡片”时执行',
      toast: '已切换为仅手动生成，不再自动创建卡片'
    }
  };

  function selectedTriggerMode() {
    return qs('input[name="triggerMode"]:checked')?.value || 'smart';
  }

  function selectedEvidenceText() {
    const selected = qs('input[name="evidenceRange"]:checked');
    return selected?.closest('label')?.querySelector('b')?.textContent || '根据学情自动选择';
  }

  function selectedSubjectText() {
    const activeSubjects = qsa('.subject-selector button.active').map((button) => button.dataset.subject);
    if (!activeSubjects.length || activeSubjects.includes('自动')) return '自动选择科目';
    return activeSubjects.join('、');
  }

  function updateStrategyPreview() {
    const mode = selectedTriggerMode();
    const config = triggerModeText[mode];
    const time = qs('#deliveryTime')?.value || '18:30';
    const schedule = qs('#triggerSchedule');
    qsa('.trigger-mode').forEach((label) => label.classList.toggle('active', qs('input', label).checked));
    schedule?.classList.toggle('is-disabled', mode === 'manual');
    qs('#timeFieldLabel').textContent = config.timeLabel;
    if (qs('#automationToggle')?.checked) qs('#automationState').textContent = config.state;
    qs('#strategySummary').textContent = config.summary(time);
    qs('#strategyEvidence').textContent = `${selectedSubjectText()} · ${selectedEvidenceText()}`;
  }

  qsa('input[name="triggerMode"]').forEach((input) => {
    input.addEventListener('change', () => {
      updateStrategyPreview();
      showToast(triggerModeText[input.value].toast);
    });
  });

  qs('#deliveryTime')?.addEventListener('change', updateStrategyPreview);

  qsa('.evidence-range label').forEach((label) => {
    qs('input', label)?.addEventListener('change', () => {
      qsa('.evidence-range label').forEach((item) => item.classList.toggle('active', qs('input', item).checked));
      updateStrategyPreview();
    });
  });

  qsa('.weekday-picker button').forEach((button) => {
    button.addEventListener('click', () => button.classList.toggle('active'));
  });

  qsa('.subject-selector button').forEach((button) => {
    button.addEventListener('click', () => {
      const autoButton = qs('.subject-selector [data-subject="自动"]');
      if (button === autoButton) {
        qsa('.subject-selector button').forEach((item) => item.classList.toggle('active', item === autoButton));
      } else {
        autoButton?.classList.remove('active');
        button.classList.toggle('active');
        if (!qs('.subject-selector button.active')) autoButton?.classList.add('active');
      }
      qsa('.subject-selector button').forEach((item) => {
        const isActive = item.classList.contains('active');
        qs('b', item).textContent = item === autoButton ? (isActive ? '推荐' : '未选') : (isActive ? '已选' : '未选');
      });
      updateStrategyPreview();
    });
  });

  const difficultyText = {
    1: '轻松巩固 · 以信心为主',
    2: '稍微轻松 · 少量提示',
    3: '正合适 · 需要一点思考',
    4: '有挑战 · 减少提示',
    5: '高挑战 · 适合主动突破'
  };

  qs('#difficultyRange')?.addEventListener('input', (event) => {
    qs('#difficultyLabel').textContent = difficultyText[event.target.value];
  });

  qs('#saveSchedule')?.addEventListener('click', () => {
    const time = qs('#deliveryTime').value || '18:30';
    const mode = selectedTriggerMode();
    qs('#settingsSaved').textContent = mode === 'manual' ? '刚刚保存 · 仅手动生成' : `刚刚保存 · 下次最迟 ${time}`;
    showToast('生成策略已保存；手动、学情更新和定时触发将共用同一个任务');
  });

  updateStrategyPreview();

  qsa('.difficulty-feedback button').forEach((button) => {
    button.addEventListener('click', () => {
      qsa('.difficulty-feedback button').forEach((item) => item.classList.toggle('active', item === button));
      selectedFeeling = button.dataset.feeling;
    });
  });

  qs('#confidenceRange')?.addEventListener('input', (event) => {
    qs('#confidenceValue').textContent = `${event.target.value} / 5`;
  });

  qs('#submitFeedback')?.addEventListener('click', () => {
    closeModal(qs('#completionModal'));
    const button = qs('#completeCard');
    button.textContent = '已完成';
    button.disabled = true;
    qs('.progress-ring').textContent = '3/3';
    showToast(`练习已完成 · 难度反馈：${selectedFeeling}`);
  });

  qsa('[data-open-history]').forEach((button) => {
    button.addEventListener('click', () => {
      switchPage('today');
      showToast(`已打开“${qs('span:nth-child(2) b', button).textContent}”`);
    });
  });

  qsa('.provider-pills button, .template-source-tabs button').forEach((button) => {
    button.addEventListener('click', () => {
      qsa('button', button.parentElement).forEach((item) => item.classList.toggle('active', item === button));
    });
  });

  qs('#exitPrototype')?.addEventListener('click', () => {
    showToast('这是独立演示页，可直接关闭浏览器标签页');
  });
})();
