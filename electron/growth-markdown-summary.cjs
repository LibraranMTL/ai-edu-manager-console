const MATURITY_LABELS = {
  established: '已形成',
  emerging: '正在形成',
  observing: '观察中',
  unverified: '证据不足',
};

const TREND_LABELS = {
  improving: '持续增强',
  stable: '保持稳定',
  insufficient: '尚不足以判断',
};

const PROJECT_STATUS_LABELS = {
  published: '已发布',
  pending_review: '积累中',
  pending: '积累中',
  not_started: '尚无成长证据',
};

function tableCells(line) {
  const value = String(line || '').trim();
  if (!value.startsWith('|') || !value.endsWith('|')) return [];
  return value.slice(1, -1).split('|').map((cell) => cell.trim());
}

function numberCell(value) {
  const parsed = Number.parseInt(String(value || '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeNames(value) {
  return String(value || '')
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter((item) => item && item !== '-' && !/^[A-Za-z]:[\\/]/.test(item) && !item.includes(':\\'))
    .slice(0, 5);
}

function parseGrowthIndexMarkdown(markdown = '') {
  const result = {
    ok: true,
    schema: 'edu-manager.student-growth-summary.v1',
    compatibilityMode: true,
    updatedAt: '',
    summary: {
      evidenceCount: 0,
      confirmedCount: 0,
      watchingCount: 0,
      abilityCount: 0,
      projectCount: 0,
      publishedProjectCount: 0,
      lastEvidenceAt: '',
    },
    abilities: [],
    projects: [],
    recentEvidence: [],
  };
  let section = '';
  for (const sourceLine of String(markdown || '').replace(/\r/g, '').split('\n')) {
    const line = sourceLine.trim();
    if (!line) continue;
    if (line.startsWith('生成时间：')) {
      result.updatedAt = line.slice('生成时间：'.length).trim();
      continue;
    }
    if (/^##\s+总览/.test(line)) { section = 'summary'; continue; }
    if (/^##\s+能力画像/.test(line)) { section = 'abilities'; continue; }
    if (/^##\s+项目贡献/.test(line)) { section = 'projects'; continue; }
    if (line.startsWith('## ') || line.startsWith('>')) { section = ''; continue; }
    const cells = tableCells(line);
    if (!cells.length || cells.every((cell) => /^[-: ]*$/.test(cell))) continue;
    if (section === 'summary' && cells.length >= 2 && cells[0] !== '指标') {
      const keyMap = {
        成长证据: 'evidenceCount',
        已确认: 'confirmedCount',
        观察中: 'watchingCount',
        能力维度: 'abilityCount',
        关联项目: 'projectCount',
        已发布项目贡献: 'publishedProjectCount',
      };
      if (keyMap[cells[0]]) result.summary[keyMap[cells[0]]] = numberCell(cells[1]);
    } else if (section === 'abilities' && cells.length >= 5 && cells[0] !== '能力') {
      result.abilities.push({
        name: cells[0] || '待标注',
        maturity: cells[1] || 'unverified',
        maturityLabel: MATURITY_LABELS[cells[1]] || MATURITY_LABELS.unverified,
        trend: cells[2] || 'insufficient',
        trendLabel: TREND_LABELS[cells[2]] || TREND_LABELS.insufficient,
        evidenceCount: numberCell(cells[3]),
        confirmedCount: numberCell(cells[4]),
        projectNames: safeNames(cells[5]),
        lastObservedAt: cells[6] && cells[6] !== '-' ? cells[6] : '',
      });
    } else if (section === 'projects' && cells.length >= 4 && cells[0] !== '项目') {
      const status = cells[1] || 'not_started';
      result.projects.push({
        projectName: cells[0] || '未命名项目',
        reviewStatus: status,
        reviewStatusLabel: PROJECT_STATUS_LABELS[status] || '积累中',
        evidenceCount: numberCell(cells[2]),
        confirmedEvidenceCount: numberCell(cells[3]),
        abilityNames: safeNames(cells[4]),
        updatedAt: cells[5] && cells[5] !== '-' ? cells[5] : '',
      });
    }
  }
  return result;
}

module.exports = { parseGrowthIndexMarkdown };
