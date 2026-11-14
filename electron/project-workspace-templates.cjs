'use strict';

const catalog = require('../shared/project-workspace-templates.json');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const PROJECT_WORKSPACE_TEMPLATES = deepFreeze(catalog.map((template) => ({
  ...template,
  folders: [...template.folders],
  deliverables: [...template.deliverables],
})));

const PROJECT_TEMPLATE_V2_STRATEGIES = deepFreeze(Object.fromEntries(PROJECT_WORKSPACE_TEMPLATES.map((template) => [template.id, {
  knowledgeStrategy: template.knowledgeStrategy,
  growthStrategy: template.growthStrategy,
  deliverables: template.deliverables,
}])));

function projectWorkspaceTemplateFor(templateId) {
  return PROJECT_WORKSPACE_TEMPLATES.find((item) => item.id === String(templateId || '')) || PROJECT_WORKSPACE_TEMPLATES[0];
}

function listProjectWorkspaceTemplates() {
  return PROJECT_WORKSPACE_TEMPLATES.map((template) => ({
    ...template,
    folders: [...template.folders],
    deliverables: [...template.deliverables],
  }));
}

module.exports = {
  PROJECT_WORKSPACE_TEMPLATES,
  PROJECT_TEMPLATE_V2_STRATEGIES,
  projectWorkspaceTemplateFor,
  listProjectWorkspaceTemplates,
};
