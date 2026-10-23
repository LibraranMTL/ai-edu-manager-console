import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, BookOpen, Bot, CheckCircle2, FileText, FolderOpen, HardDrive, Lightbulb,
  Play, Power, RefreshCw, RotateCcw, Search, ShieldCheck, Users,
} from 'lucide-react';
import './project-materials.css';

type ProjectRef = {
  id: string;
  name: string;
  status: string;
  materialStorageMode?: 'legacy' | 'workspace-v1';
  materialMigrationState?: string;
};

type Category = { categoryId: string; name: string; relativePath: string };
type Material = {
  materialId: string;
  version: number;
  recordRevision: number;
  title: string;
  logicalPath: string;
  size: number;
  updatedAt: string;
  availability: string;
  adoption: string;
  organizationState: string;
  classification: { categoryId: string; categoryName: string; source: string; manualLocked: boolean;
    inferredFromPath?: boolean; tags: string[] };
  processing: { state: string; processedVersion: number };
  pendingReasons: string[];
  recordKind: 'user_material' | 'system_generated';
  automationDisposition: 'ignored' | 'auto_ready' | 'processing' | 'confirmation' | 'error' | 'completed';
  automationReasons: string[];
  contentGroupId: string;
  sourceTypes: string[];
  knowledge: Array<{ knowledgeId: string; version: number; commitId?: string }>;
  evidence: Array<{ studentId: string; status: string; ability: string }>;
};
type KnowledgeItem = {
  knowledgeId: string;
  title: string;
  relativePath: string;
  status: string;
  committedAt: string;
  sources: Array<{ materialId: string; version: number; sha256: string }>;
};
type Contribution = {
  studentId: string;
  ability: string;
  observation: string;
  status: string;
  confidence: string;
  updatedAt: string;
  sourceStatus: string;
  sources: Array<{ materialId: string; version: number; sha256: string }>;
};
type WorkspaceView = {
  ok: boolean;
  message?: string;
  registryRevision: number;
  categories: Category[];
  total: number;
  items: Material[];
  knowledge: KnowledgeItem[];
  contributions: Contribution[];
  counts: { materials: number; uniqueContents?: number; systemGenerated?: number; pending: number; knowledge: number;
    contributions: number; candidates: number; unclassified: number; pathClassified: number; unavailable: number };
};
type MaterialAutomationOverview = {
  ok: boolean;
  message?: string;
  registryRevision: number;
  businessMaterialCount: number;
  uniqueContentCount: number;
  systemGeneratedCount: number;
  acceptedCount: number;
  autoReady: number;
  autoCompleted: number;
  processing: number;
  needsConfirmation: number;
  errors: number;
  digestPendingContentCount: number;
  automation: { enabled: boolean; autoAdoptPathClassified: boolean; autoDigest: boolean; maxBatch: number };
  job: null | { jobId: string; status: string; phase: string; processed: number; total: number; message: string };
};
type Suggestion = {
  suggestionId: string;
  materialId: string;
  version: number;
  recordRevision: number;
  categoryId: string;
  tags: string[];
  reason: string;
  source: 'ai' | 'member' | 'rule';
  status: string;
  createdAt: string;
};
type SuggestionPage = { ok: boolean; message?: string; items: Suggestion[] };
type ClassificationResult = { materialId: string; ok: boolean; code?: string; categoryId?: string; unchanged?: boolean; recordRevision?: number };
type ApplyResult = { ok: boolean; message?: string; operationId?: string; results?: ClassificationResult[] };
type AdoptionResult = { ok: boolean; partial?: boolean; updated?: number; message?: string;
  failed?: Array<{ id: string; code: string }>; compatibilityFailed?: Array<{ materialId: string; code: string; message?: string }> };
type OrganizationItem = { materialId: string; title: string; status: string; code: string; message: string; retryable: boolean; undoStatus: string };
type OrganizationOperation = { operationId: string; trigger: string; status: string; createdAt: string; completedAt: string;
  undoStatus: string; items: OrganizationItem[]; counts: { total: number; succeeded: number; failed: number; attention: number; retryable: number; undone: number } };
type OrganizationStatus = { ok: boolean; message?: string; configuration: { enabled: boolean; maxBatch: number; intervalMinutes: number;
  nextRunAt: string; lastRunAt: string; lastStatus: string; lastMessage: string }; capacity: { ok: boolean; availableBytes: number | null; reserveBytes: number; code: string };
  operations: OrganizationOperation[]; registryRevision: number };
type CleanupInspection = { ok: boolean; message?: string; candidates: Array<{ candidateId: string; area: string; name: string; size: number; modifiedAt: string }> };
type MigrationItem = { itemId: string; materialId: string; title: string; sourceKind: string; sourceLabel?: string;
  sourceRelativePath: string; targetRelativePath: string; action: string; status?: string; code: string; reason?: string;
  message?: string; retryable?: boolean; rollbackStatus?: string; size: number };
type MigrationOperation = { operationId: string; previewId: string; status: string; createdAt: string; completedAt: string;
  hasPhysicalCopies?: boolean;
  items: MigrationItem[]; counts: { total: number; succeeded: number; failed: number; attention: number; retryable: number; rolledBack: number } };
type MigrationStatus = { ok: boolean; message?: string; migrationState: string; operations: MigrationOperation[];
  backups: { count: number; bytes: number; cleanupRequiresExplicitReview: boolean }; registryRevision: number };
type MigrationPreview = { ok: boolean; message?: string; previewId: string; truncated: boolean; items: MigrationItem[];
  counts: { total: number; workspace: number; migratable: number; preserved: number; conflicts: number } };
type MigrationBackupInspection = { ok: boolean; message?: string; bytes: number;
  candidates: Array<{ candidateId: string; operationId: string; itemId: string; title: string; size: number; reason: string }> };
type MaterialsBridge = {
  getProjectMaterialWorkspaceView?: (projectId: string, queryJson: string) => Promise<string>;
  getProjectMaterialOverview?: (projectId: string) => Promise<string>;
  listProjectMaterialExceptions?: (requestJson: string) => Promise<string>;
  runProjectMaterialAutomation?: (projectId: string, requestJson: string) => Promise<string>;
  getProjectMaterialAutomationStatus?: (jobId: string) => Promise<string>;
  onProjectMaterialAutomationProgress?: (callback: (payload: string) => void) => () => void;
  getProjectClassificationSuggestions?: (projectId: string, queryJson: string) => Promise<string>;
  generateProjectClassificationSuggestions?: (projectId: string) => Promise<string>;
  applyProjectMaterialClassifications?: (projectId: string, requestJson: string) => Promise<string>;
  reviewProjectStagingItems?: (projectId: string, itemIdsJson: string, decision: string, sourceStrategy: string, note: string) => Promise<string>;
  undoProjectMaterialClassification?: (projectId: string, operationId: string, idempotencyKey: string) => Promise<string>;
  getProjectMaterialOrganizationStatus?: (projectId: string) => Promise<string>;
  configureProjectMaterialOrganization?: (projectId: string, requestJson: string) => Promise<string>;
  runProjectMaterialOrganization?: (projectId: string, requestJson: string) => Promise<string>;
  retryProjectMaterialOrganization?: (projectId: string, operationId: string, requestJson: string) => Promise<string>;
  undoProjectMaterialOrganization?: (projectId: string, operationId: string, requestJson: string) => Promise<string>;
  inspectProjectMaterialCapacityCleanup?: (projectId: string) => Promise<string>;
  cleanupProjectMaterialCapacity?: (projectId: string, requestJson: string) => Promise<string>;
  getProjectMaterialMigrationStatus?: (projectId: string) => Promise<string>;
  previewProjectMaterialMigration?: (projectId: string) => Promise<string>;
  executeProjectMaterialMigration?: (projectId: string, requestJson: string) => Promise<string>;
  retryProjectMaterialMigration?: (projectId: string, operationId: string, requestJson: string) => Promise<string>;
  rollbackProjectMaterialMigration?: (projectId: string, operationId: string, requestJson: string) => Promise<string>;
  inspectProjectMaterialMigrationBackups?: (projectId: string) => Promise<string>;
  cleanupProjectMaterialMigrationBackups?: (projectId: string, requestJson: string) => Promise<string>;
  openProjectMaterialOriginal?: (projectId: string, materialId: string, version: number) => Promise<string>;
};

type TabId = 'materials' | 'pending' | 'knowledge' | 'contributions';

const emptyView: WorkspaceView = {
  ok: true, registryRevision: 0, categories: [], total: 0, items: [], knowledge: [], contributions: [],
  counts: { materials: 0, pending: 0, knowledge: 0, contributions: 0, candidates: 0,
    unclassified: 0, pathClassified: 0, unavailable: 0 },
};
const emptyAutomationOverview: MaterialAutomationOverview = { ok: true, registryRevision: 0,
  businessMaterialCount: 0, uniqueContentCount: 0, systemGeneratedCount: 0, acceptedCount: 0,
  autoReady: 0, autoCompleted: 0, processing: 0, needsConfirmation: 0, errors: 0,
  digestPendingContentCount: 0,
  automation: { enabled: false, autoAdoptPathClassified: false, autoDigest: false, maxBatch: 20 }, job: null };
const emptyOrganization: OrganizationStatus = { ok: true,
  configuration: { enabled: false, maxBatch: 20, intervalMinutes: 1440, nextRunAt: '', lastRunAt: '', lastStatus: '', lastMessage: '' },
  capacity: { ok: true, availableBytes: null, reserveBytes: 64 * 1024 * 1024, code: '' }, operations: [], registryRevision: 0 };
const emptyMigration: MigrationStatus = { ok: true, migrationState: 'not_started', operations: [],
  backups: { count: 0, bytes: 0, cleanupRequiresExplicitReview: true }, registryRevision: 0 };

function bridge(): MaterialsBridge | undefined {
  return (window as Window & { AndroidBridge?: MaterialsBridge }).AndroidBridge;
}

function parseResponse<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function requestId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function fileSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

const pendingLabel: Record<string, string> = {
  needs_adoption: '待确认采用', needs_classification: '待分类', source_missing: '原件缺失',
  source_unavailable: '来源不可用', processing_failed: '消化异常',
};

const resultLabel: Record<string, string> = {
  version_conflict: '资料已更新，请刷新后重试', material_missing: '资料已不存在',
  category_missing: '分类已变化', stale_suggestion: '建议已过期', suggestion_mismatch: '建议内容不匹配',
  undo_conflict: '资料已继续修改，不能撤销', forbidden: '没有操作权限',
};

export function ProjectMaterialsPanel({ project }: { project: ProjectRef }) {
  const [storageMode, setStorageMode] = useState(project.materialStorageMode || 'legacy');
  const [activeTab, setActiveTab] = useState<TabId>('materials');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [categoryId, setCategoryId] = useState('');
  const [view, setView] = useState<WorkspaceView>(emptyView);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [organization, setOrganization] = useState<OrganizationStatus>(emptyOrganization);
  const [automationOverview, setAutomationOverview] = useState<MaterialAutomationOverview>(emptyAutomationOverview);
  const [migration, setMigration] = useState<MigrationStatus>({ ...emptyMigration,
    migrationState: project.materialMigrationState || 'not_started' });
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [draftCategories, setDraftCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState<ClassificationResult[]>([]);
  const [lastOperationId, setLastOperationId] = useState('');
  const requestSerial = useRef(0);
  const autoStartedRevision = useRef(-1);

  const load = useCallback(async () => {
    if (storageMode !== 'workspace-v1') return;
    const api = bridge();
    if (!api?.getProjectMaterialWorkspaceView) {
      setMessage('当前客户端尚未提供统一资料浏览能力。');
      return;
    }
    const serial = ++requestSerial.current;
    setLoading(true);
    try {
      const query = { view: activeTab === 'pending' ? 'pending' : 'materials', search: deferredSearch,
        categoryId, offset: 0, limit: 100 };
      const [viewRaw, suggestionsRaw, organizationRaw, overviewRaw] = await Promise.all([
        api.getProjectMaterialWorkspaceView(project.id, JSON.stringify(query)),
        api.getProjectClassificationSuggestions
          ? api.getProjectClassificationSuggestions(project.id, JSON.stringify({ status: 'pending', offset: 0, limit: 100 }))
          : Promise.resolve(JSON.stringify({ ok: true, items: [] })),
        api.getProjectMaterialOrganizationStatus
          ? api.getProjectMaterialOrganizationStatus(project.id)
          : Promise.resolve(JSON.stringify(emptyOrganization)),
        api.getProjectMaterialOverview
          ? api.getProjectMaterialOverview(project.id)
          : Promise.resolve(JSON.stringify(emptyAutomationOverview)),
      ]);
      if (serial !== requestSerial.current) return;
      const nextView = parseResponse<WorkspaceView>(viewRaw);
      const nextSuggestions = parseResponse<SuggestionPage>(suggestionsRaw);
      const nextOrganization = parseResponse<OrganizationStatus>(organizationRaw);
      const nextOverview = parseResponse<MaterialAutomationOverview>(overviewRaw);
      if (!nextView.ok) throw new Error(nextView.message || '项目资料读取失败。');
      setView(nextView);
      setSuggestions(nextSuggestions.ok ? nextSuggestions.items || [] : []);
      if (nextOrganization.ok) setOrganization(nextOrganization);
      if (nextOverview.ok) setAutomationOverview(nextOverview);
      if (!nextSuggestions.ok) setMessage(nextSuggestions.message || '分类建议暂时无法读取。');
      else if (!nextOrganization.ok) setMessage(nextOrganization.message || '自动整理状态暂时无法读取。');
    } catch (error) {
      if (serial === requestSerial.current) setMessage(error instanceof Error ? error.message : '项目资料读取失败。');
    } finally {
      if (serial === requestSerial.current) setLoading(false);
    }
  }, [activeTab, categoryId, deferredSearch, project.id, storageMode]);

  const loadMigration = useCallback(async () => {
    const api = bridge();
    if (!api?.getProjectMaterialMigrationStatus) return;
    try {
      const response = parseResponse<MigrationStatus>(await api.getProjectMaterialMigrationStatus(project.id));
      if (response.ok) setMigration(response);
    } catch { /* ordinary material browsing remains available */ }
  }, [project.id]);

  useEffect(() => {
    setStorageMode(project.materialStorageMode || 'legacy');
    setActiveTab('materials');
    setSearch('');
    setCategoryId('');
    setSelectedIds(new Set());
    setDraftCategories({});
    setResults([]);
    setLastOperationId('');
    setMessage('');
    setOrganization(emptyOrganization);
    setAutomationOverview(emptyAutomationOverview);
    autoStartedRevision.current = -1;
    setMigration({ ...emptyMigration, migrationState: project.materialMigrationState || 'not_started' });
    setMigrationPreview(null);
  }, [project.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadMigration(); }, [loadMigration]);

  const runMaterialAutomation = useCallback(async (reason = 'manual') => {
    const api = bridge();
    if (!api?.runProjectMaterialAutomation || busy) return;
    setBusy(true);
    try {
      const response = parseResponse<{ ok: boolean; message?: string; jobId?: string }>(
        await api.runProjectMaterialAutomation(project.id, JSON.stringify({ reason,
          maxBatch: automationOverview.automation.maxBatch,
          idempotencyKey: requestId(`material-automation-${automationOverview.registryRevision}`) })));
      if (!response.ok) throw new Error(response.message || '自动处理未启动。');
      setMessage(response.message || '已进入后台资源队列。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '自动处理未启动。'); }
    finally { setBusy(false); }
  }, [automationOverview.automation.maxBatch, automationOverview.registryRevision, busy, project.id]);

  useEffect(() => {
    if (!automationOverview.automation.enabled || automationOverview.autoReady <= 0
      || autoStartedRevision.current === automationOverview.registryRevision) return;
    autoStartedRevision.current = automationOverview.registryRevision;
    void runMaterialAutomation('page_entry');
  }, [automationOverview.autoReady, automationOverview.automation.enabled,
    automationOverview.registryRevision, runMaterialAutomation]);

  useEffect(() => {
    const api = bridge();
    if (!api?.onProjectMaterialAutomationProgress) return undefined;
    return api.onProjectMaterialAutomationProgress((payload) => {
      try {
        const progress = JSON.parse(payload) as { projectId: string; status: string; message: string };
        if (progress.projectId !== project.id) return;
        setMessage(progress.message || '项目资料正在后台处理。');
        if (['completed', 'failed'].includes(progress.status)) void load();
      } catch { /* ignore unrelated progress payloads */ }
    });
  }, [load, project.id]);

  const materialById = useMemo(() => new Map(view.items.map((item) => [item.materialId, item])), [view.items]);
  const suggestionByMaterial = useMemo(() => {
    const map = new Map<string, Suggestion>();
    for (const item of suggestions) if (!map.has(item.materialId)) map.set(item.materialId, item);
    return map;
  }, [suggestions]);
  const categoryById = useMemo(() => new Map(view.categories.map((item) => [item.categoryId, item])), [view.categories]);
  const selectedVisible = view.items.filter((item) => selectedIds.has(item.materialId));
  const pathRecognizedVisible = view.items.filter((item) => item.classification.source === 'workspace_path');
  const allVisibleSelected = view.items.length > 0 && view.items.every((item) => selectedIds.has(item.materialId));

  function categoryForSelection(item: Material) {
    const suggestion = suggestionByMaterial.get(item.materialId);
    const suggestionIsCurrent = suggestion?.version === item.version
      && suggestion.recordRevision === item.recordRevision;
    return item.classification.categoryId || (suggestionIsCurrent ? suggestion.categoryId : '');
  }

  function selectMaterials(items: Material[], replace = false) {
    setSelectedIds((current) => {
      const next = replace ? new Set<string>() : new Set(current);
      for (const item of items) next.add(item.materialId);
      return next;
    });
    setDraftCategories((current) => {
      const next = { ...current };
      for (const item of items) if (!next[item.materialId]) next[item.materialId] = categoryForSelection(item);
      return next;
    });
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const item of view.items) next.delete(item.materialId);
        return next;
      });
      return;
    }
    selectMaterials(view.items);
  }

  function selectPathRecognized() {
    selectMaterials(pathRecognizedVisible, true);
    setMessage(pathRecognizedVisible.length
      ? `已选择 ${pathRecognizedVisible.length} 份目录已识别资料；可一次确认采用。`
      : '当前列表没有可按目录直接识别的资料。');
  }

  function clearVisibleSelection() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of view.items) next.delete(item.materialId);
      return next;
    });
  }

  const selectedWithoutCategory = selectedVisible.filter((item) =>
    !(draftCategories[item.materialId] || item.classification.categoryId));

  function toggleMaterial(item: Material) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(item.materialId)) next.delete(item.materialId); else next.add(item.materialId);
      return next;
    });
    setDraftCategories((current) => current[item.materialId] !== undefined ? current : {
      ...current, [item.materialId]: categoryForSelection(item),
    });
  }

  function useSuggestion(item: Material, suggestion: Suggestion) {
    if (suggestion.version !== item.version || suggestion.recordRevision !== item.recordRevision) {
      setMessage('这条建议对应旧版本资料，刷新后才能继续处理。');
      return;
    }
    setDraftCategories((current) => ({ ...current, [item.materialId]: suggestion.categoryId }));
    setSelectedIds((current) => new Set(current).add(item.materialId));
    setMessage('已把建议加入待应用清单；点击“确认分类并采用”可一次完成待整理审核。');
  }

  async function applySelected(adopt: boolean) {
    const api = bridge();
    if (!api?.applyProjectMaterialClassifications || busy) return;
    const items = selectedVisible.map((material) => {
      const targetCategory = draftCategories[material.materialId] || material.classification.categoryId;
      const suggestion = suggestionByMaterial.get(material.materialId);
      const suggestionIsCurrent = suggestion?.version === material.version
        && suggestion.recordRevision === material.recordRevision;
      const acceptsSuggestion = suggestionIsCurrent && suggestion?.categoryId === targetCategory;
      return {
        materialId: material.materialId, expectedVersion: material.version,
        expectedRecordRevision: material.recordRevision, categoryId: targetCategory,
        tags: acceptsSuggestion ? suggestion.tags : [], suggestionId: suggestionIsCurrent ? suggestion.suggestionId : '',
        decision: acceptsSuggestion ? 'accept' : 'correct',
      };
    });
    if (!items.length) { setMessage('请先选择需要分类的资料。'); return; }
    if (items.some((item) => !item.categoryId)) { setMessage('请为每份所选资料指定分类。'); return; }
    setBusy(true);
    setResults([]);
    try {
      const response = parseResponse<ApplyResult>(await api.applyProjectMaterialClassifications(project.id,
        JSON.stringify({ items, idempotencyKey: requestId('host-classification') })));
      if (!response.ok) throw new Error(response.message || '分类没有应用。');
      const nextResults = response.results || [];
      setResults(nextResults);
      setLastOperationId(adopt ? '' : (response.operationId || ''));
      const succeeded = nextResults.filter((item) => item.ok).length;
      let nextMessage = `已保存 ${succeeded}/${nextResults.length} 份资料的工作空间分类。`;
      const failedIds = new Set(nextResults.filter((item) => !item.ok).map((item) => item.materialId));
      if (adopt) {
        if (!api.reviewProjectStagingItems) throw new Error('当前客户端尚未提供采用审核能力；分类已保存，请刷新后重试采用。');
        const adoptionItems = nextResults.filter((item) => item.ok).map((item) => {
          const material = materialById.get(item.materialId);
          return material && material.adoption !== 'accepted' && Number.isSafeInteger(item.recordRevision)
            ? { id: item.materialId, expectedVersion: material.version,
              expectedRecordRevision: item.recordRevision as number } : null;
        }).filter((item): item is { id: string; expectedVersion: number; expectedRecordRevision: number } => Boolean(item));
        let adoptedIds = nextResults.filter((item) => item.ok && materialById.get(item.materialId)?.adoption === 'accepted')
          .map((item) => item.materialId);
        if (adoptionItems.length) {
          const adoption = parseResponse<AdoptionResult>(await api.reviewProjectStagingItems(project.id,
            JSON.stringify(adoptionItems), 'accepted', 'keep_original', '主机资料中心：确认分类并采用'));
          for (const item of adoption.failed || []) failedIds.add(item.id);
          adoptedIds = [...adoptedIds, ...adoptionItems
            .filter((item) => !(adoption.failed || []).some((failed) => failed.id === item.id))
            .map((item) => item.id)];
          nextMessage += adoption.updated
            ? ` 已同步采用 ${adoption.updated} 份，它们将不再因“待确认采用”留在待整理。`
            : ` ${adoption.message || '本次没有新的采用状态变更。'}`;
          if (adoption.compatibilityFailed?.length) nextMessage += ` ${adoption.compatibilityFailed.length} 份兼容资产引用待后续重扫，不影响已保存的采用状态。`;
        } else {
          nextMessage += ' 所选资料均已采用，无需重复审核。';
        }
        const organizationIds = [...new Set(adoptedIds)].filter((id) => !failedIds.has(id));
        if (organization.configuration.enabled && organizationIds.length && api.runProjectMaterialOrganization) {
          const organized = parseResponse<{ ok: boolean; message?: string; operation?: OrganizationOperation | null }>(
            await api.runProjectMaterialOrganization(project.id, JSON.stringify({ materialIds: organizationIds,
              idempotencyKey: requestId('organization-after-adoption'), trigger: 'manual' })));
          if (organized.ok) nextMessage += ` ${organized.message || '已按授权尝试整理收件箱原件。'}`;
          else nextMessage += ` 采用状态已保存，但自动整理未执行：${organized.message || '请稍后手动重试。'}`;
        }
      } else {
        nextMessage += ' 本次仅保存分类，不改变采用状态或原件位置。';
      }
      setMessage(nextMessage);
      setSelectedIds(failedIds);
      setDraftCategories((current) => Object.fromEntries(Object.entries(current)
        .filter(([materialId]) => failedIds.has(materialId))));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '确认分类失败。');
    } finally { setBusy(false); }
  }

  async function generateSuggestions() {
    const api = bridge();
    if (!api?.generateProjectClassificationSuggestions || busy) return;
    setBusy(true);
    try {
      const response = parseResponse<{ ok: boolean; message?: string }>(
        await api.generateProjectClassificationSuggestions(project.id));
      if (!response.ok) throw new Error(response.message || '自动分类建议没有生成。');
      setMessage(response.message || '自动分类建议已生成；人工确认前不会写入正式分类。');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成自动分类建议失败。');
    } finally { setBusy(false); }
  }

  async function undoLastOperation() {
    const api = bridge();
    if (!api?.undoProjectMaterialClassification || !lastOperationId || busy) return;
    setBusy(true);
    try {
      const response = parseResponse<ApplyResult>(await api.undoProjectMaterialClassification(project.id,
        lastOperationId, requestId('host-classification-undo')));
      if (!response.ok) throw new Error(response.message || '撤销没有完成。');
      setResults(response.results || []);
      setLastOperationId('');
      setMessage('已撤销仍符合条件的分类记录；后续有修改的资料保持不变。');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销分类失败。');
    } finally { setBusy(false); }
  }

  async function revealOriginal(item: Material) {
    const api = bridge();
    if (!api?.openProjectMaterialOriginal) return;
    const response = parseResponse<{ ok: boolean; message?: string }>(await api.openProjectMaterialOriginal(
      project.id, item.materialId, item.version));
    setMessage(response.message || (response.ok ? '已定位原件。' : '未能定位原件。'));
  }

  async function configureOrganization(enabled: boolean) {
    const api = bridge();
    if (!api?.configureProjectMaterialOrganization || busy) return;
    if (enabled && !window.confirm('启用后，主机可在扫描或接收新资料后自动移动“收件箱”中的安全单文件。\n\n人工分类始终优先；代码、CAD、网页资源、关联附件和同名冲突保持原位；每次操作均可查看回执并在条件允许时撤销。\n\n确认一次授权此项目吗？')) return;
    setBusy(true);
    try {
      const response = parseResponse<{ ok: boolean; message?: string }>(await api.configureProjectMaterialOrganization(project.id,
        JSON.stringify({ enabled, maxBatch: organization.configuration.maxBatch || 20,
          intervalMinutes: organization.configuration.intervalMinutes || 1440,
          onWorkspaceChange: true, idempotencyKey: requestId('organization-configuration') })));
      if (!response.ok) throw new Error(response.message || '自动整理设置未保存。');
      setMessage(response.message || (enabled ? '自动整理已授权。' : '自动整理已关闭。'));
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '自动整理设置失败。'); }
    finally { setBusy(false); }
  }

  async function runOrganizationNow() {
    const api = bridge();
    if (!api?.runProjectMaterialOrganization || busy) return;
    setBusy(true);
    try {
      const response = parseResponse<{ ok: boolean; message?: string }>(await api.runProjectMaterialOrganization(project.id,
        JSON.stringify({ idempotencyKey: requestId('organization-run'), trigger: 'manual' })));
      if (!response.ok) throw new Error(response.message || '自动整理未运行。');
      setMessage(response.message || '自动整理完成。');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '自动整理失败。'); }
    finally { setBusy(false); }
  }

  async function retryOrganization(operation: OrganizationOperation) {
    const api = bridge();
    if (!api?.retryProjectMaterialOrganization || busy) return;
    const materialIds = operation.items.filter((item) => item.retryable).map((item) => item.materialId);
    if (!materialIds.length) { setMessage('这次操作没有可直接重试的条目，请先处理冲突原因。'); return; }
    setBusy(true);
    try {
      const response = parseResponse<{ ok: boolean; message?: string }>(await api.retryProjectMaterialOrganization(project.id,
        operation.operationId, JSON.stringify({ materialIds, idempotencyKey: requestId('organization-retry') })));
      if (!response.ok) throw new Error(response.message || '异常条目未能重试。');
      setMessage(response.message || '已重试可恢复的异常条目。');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '重试失败。'); }
    finally { setBusy(false); }
  }

  async function undoOrganization(operation: OrganizationOperation) {
    const api = bridge();
    if (!api?.undoProjectMaterialOrganization || busy) return;
    if (!window.confirm('撤销只会恢复仍为同一版本、分类未继续修改且原位置空闲的文件；不会覆盖新文件。继续吗？')) return;
    setBusy(true);
    try {
      const response = parseResponse<{ ok: boolean; message?: string }>(await api.undoProjectMaterialOrganization(project.id,
        operation.operationId, JSON.stringify({ idempotencyKey: requestId('organization-undo') })));
      if (!response.ok) throw new Error(response.message || '自动整理未能撤销。');
      setMessage(response.message || '已撤销仍符合安全条件的条目；冲突项保持不变。');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '撤销失败。'); }
    finally { setBusy(false); }
  }

  async function inspectAndCleanup() {
    const api = bridge();
    if (!api?.inspectProjectMaterialCapacityCleanup || !api.cleanupProjectMaterialCapacity || busy) return;
    setBusy(true);
    try {
      const inspection = parseResponse<CleanupInspection>(await api.inspectProjectMaterialCapacityCleanup(project.id));
      if (!inspection.ok) throw new Error(inspection.message || '临时残件检查失败。');
      if (!inspection.candidates.length) { setMessage('没有发现超过24小时的已知临时残件；原文和受保护版本未扫描为清理对象。'); return; }
      const size = inspection.candidates.reduce((sum, item) => sum + item.size, 0);
      if (!window.confirm(`发现 ${inspection.candidates.length} 个超过24小时的已知临时残件（${fileSize(size)}）。\n\n只清理本次列出的上传/快照 .partial 文件；原文、固定版本和迁移备份不会删除。继续吗？`)) return;
      const response = parseResponse<{ ok: boolean; message?: string }>(await api.cleanupProjectMaterialCapacity(project.id,
        JSON.stringify({ candidateIds: inspection.candidates.map((item) => item.candidateId),
          idempotencyKey: requestId('capacity-cleanup') })));
      if (!response.ok) throw new Error(response.message || '临时残件未清理。');
      setMessage(response.message || '临时残件清理完成。');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '容量检查失败。'); }
    finally { setBusy(false); }
  }

  async function previewMigration() {
    const api = bridge();
    if (!api?.previewProjectMaterialMigration || busy) return;
    setBusy(true);
    try {
      const response = parseResponse<MigrationPreview>(await api.previewProjectMaterialMigration(project.id));
      if (!response.ok) throw new Error(response.message || '迁移预览失败。');
      setMigrationPreview(response);
      setMessage(response.message || '迁移预览已完成；执行前不会移动任何文件。');
      await loadMigration();
    } catch (error) { setMessage(error instanceof Error ? error.message : '迁移预览失败。'); }
    finally { setBusy(false); }
  }

  async function executeMigration() {
    const api = bridge();
    if (!api?.executeProjectMaterialMigration || !migrationPreview || busy) return;
    const itemIds = migrationPreview.items.filter((item) => !item.code
      && ['associate', 'migrate', 'associate_existing'].includes(item.action)).slice(0, 100).map((item) => item.itemId);
    if (!itemIds.length) { setMessage('本次预览没有可安全执行的条目；保留原位项需要先处理原因。'); return; }
    if (!window.confirm(`将逐项处理 ${itemIds.length} 份资料。\n\n工作空间现有文件只登记；旧目录普通文件先复制、校验并保留迁移备份，再切换登记。外部修改、附件依赖和同名冲突均保留原位。继续吗？`)) return;
    setBusy(true);
    try {
      const response = parseResponse<{ ok: boolean; message?: string; migrationState?: string }>(
        await api.executeProjectMaterialMigration(project.id, JSON.stringify({ previewId: migrationPreview.previewId,
          itemIds, idempotencyKey: requestId('history-migration') })));
      if (!response.ok) throw new Error(response.message || '历史迁移未完成。');
      setMessage(response.message || '历史资料迁移已逐项完成。');
      setMigrationPreview(null);
      if (response.migrationState === 'complete' || response.migrationState === 'partial') setStorageMode('workspace-v1');
      await loadMigration();
    } catch (error) { setMessage(error instanceof Error ? error.message : '执行历史迁移失败。'); }
    finally { setBusy(false); }
  }

  async function retryMigration(operation: MigrationOperation) {
    const api = bridge();
    if (!api?.retryProjectMaterialMigration || busy) return;
    const itemIds = operation.items.filter((item) => item.retryable).map((item) => item.itemId);
    if (!itemIds.length) { setMessage('当前没有可直接重试的迁移项，请重新预览外部变化。'); return; }
    setBusy(true);
    try {
      const response = parseResponse<{ ok: boolean; message?: string; migrationState?: string }>(
        await api.retryProjectMaterialMigration(project.id, operation.operationId,
          JSON.stringify({ itemIds, idempotencyKey: requestId('history-migration-retry') })));
      if (!response.ok) throw new Error(response.message || '迁移重试未完成。');
      setMessage(response.message || '已重试可恢复的迁移项。');
      if (response.migrationState === 'partial') setStorageMode('workspace-v1');
      await loadMigration();
    } catch (error) { setMessage(error instanceof Error ? error.message : '迁移重试失败。'); }
    finally { setBusy(false); }
  }

  async function rollbackMigration(operation: MigrationOperation) {
    const api = bridge();
    if (!api?.rollbackProjectMaterialMigration || busy) return;
    if (!window.confirm('只回滚迁移后未被编辑、登记未继续变化且旧位置空闲的文件；任何冲突都会保留现状。迁移备份不会自动删除。继续吗？')) return;
    setBusy(true);
    try {
      const response = parseResponse<{ ok: boolean; message?: string }>(await api.rollbackProjectMaterialMigration(
        project.id, operation.operationId, JSON.stringify({ idempotencyKey: requestId('history-migration-rollback') })));
      if (!response.ok) throw new Error(response.message || '迁移回滚未完成。');
      setMessage(response.message || '已回滚仍满足安全条件的迁移项。');
      await loadMigration();
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '迁移回滚失败。'); }
    finally { setBusy(false); }
  }

  async function inspectAndCleanupMigrationBackups() {
    const api = bridge();
    if (!api?.inspectProjectMaterialMigrationBackups || !api?.cleanupProjectMaterialMigrationBackups || busy) return;
    setBusy(true);
    try {
      const inspection = parseResponse<MigrationBackupInspection>(
        await api.inspectProjectMaterialMigrationBackups(project.id));
      if (!inspection.ok) throw new Error(inspection.message || '迁移备份检查失败。');
      if (!inspection.candidates.length) { setMessage(inspection.message || '当前没有可安全清理的迁移备份。'); return; }
      const selected = inspection.candidates.slice(0, 100);
      if (!window.confirm(`找到 ${selected.length} 份重复迁移备份（${fileSize(selected.reduce((sum, item) => sum + item.size, 0))}）。\n\n只清理已安全回滚，或已有同版本只读快照的副本；执行前会逐份重新校验。继续吗？`)) return;
      const response = parseResponse<{ ok: boolean; message?: string }>(
        await api.cleanupProjectMaterialMigrationBackups(project.id, JSON.stringify({
          candidateIds: selected.map((item) => item.candidateId), idempotencyKey: requestId('migration-backup-cleanup'),
        })));
      if (!response.ok) throw new Error(response.message || '迁移备份未清理。');
      setMessage(response.message || '迁移备份清理完成。');
      await loadMigration();
    } catch (error) { setMessage(error instanceof Error ? error.message : '迁移备份检查失败。'); }
    finally { setBusy(false); }
  }

  const tabs: Array<{ id: TabId; label: string; count: number; icon: React.ReactNode }> = [
    { id: 'materials', label: '项目资料', count: view.counts.materials, icon: <Archive size={17} /> },
    { id: 'pending', label: '需确认', count: view.counts.pending, icon: <Lightbulb size={17} /> },
    { id: 'knowledge', label: '项目知识', count: view.counts.knowledge, icon: <BookOpen size={17} /> },
    { id: 'contributions', label: '贡献证据', count: view.counts.contributions, icon: <Users size={17} /> },
  ];

  if (storageMode !== 'workspace-v1') return (
    <section className="pm-shell pm-legacy" aria-label="统一项目资料">
      <ShieldCheck size={22} />
      <div className="pm-migration-intro"><strong>统一资料视图将在受控迁移后启用</strong>
        <p>当前项目仍沿用旧资料模式。先做只读预览，再逐项复制、核验和切换；不能安全处理的文件保留原位。</p>
        <button type="button" className="primary compact" onClick={() => void previewMigration()} disabled={busy || project.status === 'sealed'}>
          <HardDrive size={15} />{busy ? '正在核验…' : '预览历史资料迁移'}</button>
        {migrationPreview && <section className="pm-migration-preview"><strong>预览结果</strong>
          <span>工作空间原位登记 {migrationPreview.counts.workspace} · 可迁移 {migrationPreview.counts.migratable} · 保留原位 {migrationPreview.counts.preserved} · 冲突 {migrationPreview.counts.conflicts}</span>
          {migrationPreview.truncated && <small>项目文件超过单次预览上限；本轮只处理已核验部分，完成后须继续预览。</small>}
          {migrationPreview.items.filter((item) => item.code).slice(0, 6).map((item) => <small key={item.itemId}>{item.title}：{item.reason || item.code}</small>)}
          <button type="button" className="primary compact" onClick={() => void executeMigration()} disabled={busy}>执行本批安全项</button>
        </section>}
        {migration.operations.slice(0, 2).map((operation) => <section className="pm-migration-receipt" key={operation.operationId}>
          <strong>{operation.status === 'succeeded' ? '迁移完成' : operation.status === 'partial' ? '部分统一' : '需要核对'}</strong>
          <span>成功 {operation.counts.succeeded}/{operation.counts.total} · 异常 {operation.counts.failed + operation.counts.attention}</span>
          {operation.counts.retryable > 0 && <button type="button" className="secondary compact" onClick={() => void retryMigration(operation)} disabled={busy}>重试可恢复项</button>}
        </section>)}
        {message && <div className="pm-message" role="status">{message}</div>}
      </div>
    </section>
  );

  return (
    <section className="pm-shell" aria-labelledby="project-materials-heading">
      <header className="pm-heading">
        <div>
          <span className="pm-eyebrow"><ShieldCheck size={15} />统一原件 · 多视角浏览</span>
          <h3 id="project-materials-heading">项目资料中心</h3>
          <p>同一份原件按工作空间分类、知识来源和贡献证据分别浏览；人工分类只写元数据，自动物理整理须按项目一次授权。</p>
        </div>
        <button type="button" className="secondary compact" onClick={() => void load()} disabled={loading || busy}>
          <RefreshCw size={16} />刷新
        </button>
        <button type="button" className="secondary compact" onClick={() => void generateSuggestions()} disabled={loading || busy || project.status === 'sealed'}>
          <Bot size={16} />自动建议
        </button>
      </header>

      <section className="pm-automation-overview" aria-label="项目资料自动处理概况">
        <div className="pm-overview-copy">
          <span className="pm-eyebrow"><Bot size={15} />只审异常</span>
          <strong>{automationOverview.businessMaterialCount} 个资料位置 · {automationOverview.uniqueContentCount} 种内容</strong>
          <p>{automationOverview.systemGeneratedCount > 0
            ? `${automationOverview.systemGeneratedCount} 个系统文件已从业务资料和迁移异常中排除。`
            : '系统文件不会进入业务资料、知识来源或待确认列表。'}</p>
        </div>
        <div className="pm-overview-stats">
          <span><b>{automationOverview.acceptedCount}</b>已采用</span>
          <span><b>{automationOverview.processing}</b>后台处理中</span>
          <span className={automationOverview.needsConfirmation ? 'attention' : ''}><b>{automationOverview.needsConfirmation}</b>需要你确认</span>
          <span className={automationOverview.errors ? 'error' : ''}><b>{automationOverview.errors}</b>处理异常</span>
        </div>
        <div className="pm-overview-action">
          <button type="button" className="primary compact" onClick={() => void runMaterialAutomation('manual')}
            disabled={busy || project.status === 'sealed'}><Play size={15} />{busy ? '正在启动…' : '立即处理'}</button>
          <small>{automationOverview.autoReady > 0
            ? `${automationOverview.autoReady} 份低风险资料可自动采用；每批最多 ${automationOverview.automation.maxBatch} 份。`
            : automationOverview.processing > 0 ? `${automationOverview.digestPendingContentCount} 种内容正在等待去重消化。`
              : '当前仅保留确需判断的异常项。'}</small>
        </div>
      </section>

      {(migration.migrationState === 'partial' || migration.migrationState === 'attention'
        || migration.operations.length > 0) && <section className="pm-migration-status" aria-label="历史资料归一状态">
        <div><strong>{migration.migrationState === 'complete' ? '历史资料已归一' : migration.migrationState === 'attention' ? '迁移现场需要核对' : '历史资料部分统一'}</strong>
          <span>旧原始库、外部来源或依赖文件可以保留原位；统一浏览不等于全部物理搬迁。</span>
          {migration.backups.count > 0 && <small>迁移备份 {migration.backups.count} 份（{fileSize(migration.backups.bytes)}），不会自动删除。</small>}</div>
        <div className="pm-automation-actions"><button type="button" className="secondary compact" onClick={() => void previewMigration()} disabled={busy || project.status === 'sealed'}><HardDrive size={14} />继续预览历史资料</button>
          {migration.backups.count > 0 && <button type="button" className="secondary compact" onClick={() => void inspectAndCleanupMigrationBackups()} disabled={busy || project.status === 'sealed'}><Archive size={14} />检查备份清理</button>}</div>
        {migrationPreview && <div className="pm-migration-preview"><span>本次可处理 {Math.min(100, migrationPreview.items.filter((item) => !item.code && ['associate', 'migrate', 'associate_existing'].includes(item.action)).length)} 项，保留原位 {migrationPreview.counts.preserved} 项。</span>
          <button type="button" className="primary compact" onClick={() => void executeMigration()} disabled={busy}>执行本批安全项</button></div>}
        {migration.operations.slice(0, 2).map((operation) => <div className="pm-migration-receipt" key={operation.operationId}><span>成功 {operation.counts.succeeded}/{operation.counts.total} · 异常 {operation.counts.failed + operation.counts.attention}</span>
          {operation.counts.retryable > 0 && <button type="button" className="secondary compact" onClick={() => void retryMigration(operation)} disabled={busy}>重试可恢复项</button>}
          {operation.hasPhysicalCopies && operation.counts.succeeded > operation.counts.rolledBack && <button type="button" className="secondary compact" onClick={() => void rollbackMigration(operation)} disabled={busy}>安全回滚</button>}
          {operation.items.filter((item) => item.status !== 'succeeded').slice(0, 4).map((item) => <small key={item.itemId}>{item.title}：{item.message || item.reason || item.code}</small>)}</div>)}
      </section>}

      <details className="pm-advanced">
        <summary>高级：物理整理、临时残件与操作记录</summary>
      <section className={`pm-automation ${organization.configuration.enabled ? 'enabled' : ''}`} aria-label="收件箱自动整理">
        <div className="pm-automation-state">
          <span className="pm-automation-icon">{organization.configuration.enabled ? <Power size={18} /> : <Bot size={18} />}</span>
          <div><strong>{organization.configuration.enabled ? '收件箱自动整理已授权' : '当前为建议分类模式'}</strong>
            <p>{organization.configuration.enabled
              ? `主机扫描或接收后按安全规则整理，每批最多 ${organization.configuration.maxBatch} 份；人工分类优先。`
              : '自动建议不会移动原件；可在理解安全边界后，对当前项目一次授权自动整理。'}</p>
            {!organization.capacity.ok && <small className="pm-capacity-warning">磁盘空间状态：{organization.capacity.code === 'insufficient_space' ? '低于安全余量，自动任务已暂停' : '暂时无法确认，自动任务已暂停'}</small>}
          </div>
        </div>
        <div className="pm-automation-actions">
          <button type="button" className="secondary compact" onClick={() => void inspectAndCleanup()} disabled={busy}>
            <HardDrive size={15} />检查临时残件</button>
          {organization.configuration.enabled && <button type="button" className="secondary compact" onClick={() => void runOrganizationNow()} disabled={busy || project.status === 'sealed'}>
            <Play size={15} />立即整理一次</button>}
          <button type="button" className={organization.configuration.enabled ? 'secondary compact' : 'primary compact'}
            onClick={() => void configureOrganization(!organization.configuration.enabled)} disabled={busy || project.status === 'sealed'}>
            <Power size={15} />{organization.configuration.enabled ? '关闭自动整理' : '一次授权启用'}</button>
        </div>
        {organization.operations.slice(0, 3).map((operation) => <div className="pm-automation-receipt" key={operation.operationId}>
          <div><strong>{operation.status === 'succeeded' ? '整理完成' : operation.status === 'partial' ? '部分完成' : operation.status === 'attention' ? '需要主机核对' : '整理未完成'}</strong>
            <span>{new Date(operation.completedAt || operation.createdAt).toLocaleString('zh-CN')} · 成功 {operation.counts.succeeded}/{operation.counts.total}{operation.counts.failed ? ` · 异常 ${operation.counts.failed}` : ''}{operation.counts.attention ? ` · 待核对 ${operation.counts.attention}` : ''}</span></div>
          <div className="pm-automation-actions">
            {operation.counts.retryable > 0 && <button type="button" className="secondary compact" onClick={() => void retryOrganization(operation)} disabled={busy || project.status === 'sealed'}><RefreshCw size={14} />重试异常项</button>}
            {operation.counts.succeeded > operation.counts.undone && <button type="button" className="secondary compact" onClick={() => void undoOrganization(operation)} disabled={busy || project.status === 'sealed'}><RotateCcw size={14} />安全撤销</button>}
          </div>
          {operation.items.filter((item) => item.status !== 'succeeded' || item.undoStatus === 'failed').slice(0, 4)
            .map((item) => <small key={item.materialId}>{item.title}：{item.message || resultLabel[item.code] || item.code || '等待处理'}</small>)}
        </div>)}
      </section>
      </details>

      <nav className="pm-tabs" aria-label="项目资料视图">
        {tabs.map((tab) => <button type="button" key={tab.id} className={activeTab === tab.id ? 'active' : ''}
          aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => setActiveTab(tab.id)}>
          {tab.icon}<span>{tab.label}</span><b>{tab.count}</b>
        </button>)}
      </nav>

      {(activeTab === 'materials' || activeTab === 'pending') && <>
        <div className="pm-toolbar">
          <label className="pm-search"><Search size={16} /><span className="sr-only">搜索项目资料</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索文件名、逻辑路径或分类" />
          </label>
          <label><span className="sr-only">按分类筛选</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">全部分类</option>
            {view.categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
          </select></label>
          <span className="pm-summary">候选 {view.counts.candidates} · 目录已识别 {view.counts.pathClassified || 0} · 未分类 {view.counts.unclassified} · 来源异常 {view.counts.unavailable}</span>
        </div>

        {view.items.length > 0 && <div className="pm-batch-tools" aria-label="批量选择资料">
          <div><strong>快捷选择</strong><span>当前列表最多显示 100 份；目录明确的资料无需逐份确认分类。</span></div>
          <button type="button" className="secondary compact" onClick={toggleAllVisible} disabled={busy}>
            {allVisibleSelected ? '取消全选当前列表' : `全选当前列表（${view.items.length}）`}</button>
          <button type="button" className="secondary compact" onClick={selectPathRecognized}
            disabled={busy || !pathRecognizedVisible.length}>选择目录已识别（{pathRecognizedVisible.length}）</button>
          {selectedVisible.length > 0 && <button type="button" className="secondary compact" onClick={clearVisibleSelection} disabled={busy}>清除选择</button>}
        </div>}

        {loading ? <div className="pm-loading" role="status"><span /><span /><span />正在读取统一资料登记…</div>
          : view.items.length ? <div className="pm-list">
            {view.items.map((item) => {
              const suggestion = suggestionByMaterial.get(item.materialId);
              const chosenCategory = draftCategories[item.materialId] ?? item.classification.categoryId;
              const suggestionCurrent = suggestion && suggestion.version === item.version && suggestion.recordRevision === item.recordRevision;
              return <article className={`pm-material ${selectedIds.has(item.materialId) ? 'selected' : ''}`} key={item.materialId}>
                <div className="pm-check"><input type="checkbox" aria-label={`选择 ${item.title}`}
                  checked={selectedIds.has(item.materialId)} onChange={() => toggleMaterial(item)} /></div>
                <div className="pm-file-icon"><FileText size={20} /></div>
                <div className="pm-material-main">
                  <div className="pm-material-title"><strong>{item.title}</strong><span>v{item.version}</span>
                    {item.classification.manualLocked && <em><ShieldCheck size={13} />人工确认</em>}
                    {!item.classification.manualLocked && item.classification.source === 'workspace_path'
                      && <em className="path-recognized"><FolderOpen size={13} />目录已识别</em>}</div>
                  <small>{item.logicalPath}</small>
                  <div className="pm-meta"><span>{fileSize(item.size)}</span><span>{item.adoption === 'accepted' ? '已采用' : item.adoption === 'excluded' ? '已排除' : '候选资料'}</span>
                    <span>{item.processing.state === 'processed' ? '已消化' : item.processing.state === 'failed' ? '消化异常' : '待消化'}</span>
                    {item.knowledge.length > 0 && <span>关联知识 {item.knowledge.length}</span>}
                    {item.evidence.length > 0 && <span>贡献证据 {item.evidence.length}</span>}</div>
                  {item.pendingReasons.length > 0 && <div className="pm-reasons">{item.pendingReasons.map((reason) => <span key={reason}>{pendingLabel[reason] || reason}</span>)}</div>}
                  {suggestion && !item.classification.categoryId && <div className={`pm-suggestion ${suggestionCurrent ? '' : 'stale'}`}>
                    <div><b>{suggestion.source === 'ai' ? <><Bot size={15} />AI 建议</>
                      : suggestion.source === 'rule' ? <><Bot size={15} />自动规则建议</> : <><Users size={15} />成员建议</>}</b>
                      <span>建议归入“{categoryById.get(suggestion.categoryId)?.name || '已变更分类'}”</span></div>
                    <p><strong>为什么这样建议：</strong>{suggestion.reason || '提交者未填写说明。'}</p>
                    <button type="button" className="secondary compact" disabled={!suggestionCurrent || busy}
                      onClick={() => useSuggestion(item, suggestion)}>{suggestionCurrent ? '采用到待应用清单' : '建议已过期'}</button>
                  </div>}
                </div>
                <div className="pm-material-actions">
                  <label><span className="pm-field-label">工作空间分类
                    {chosenCategory !== item.classification.categoryId && <em>待应用</em>}
                    {item.classification.inferredFromPath && <small>继承所在目录</small>}</span>
                    <select aria-label={`${item.title} 的工作空间分类`} value={chosenCategory}
                    disabled={project.status === 'sealed' || busy} onChange={(event) => {
                      setDraftCategories((current) => ({ ...current, [item.materialId]: event.target.value }));
                      setSelectedIds((current) => new Set(current).add(item.materialId));
                    }}><option value="">待分类</option>{view.categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}</select></label>
                  <button type="button" className="secondary compact" onClick={() => void revealOriginal(item)} disabled={busy || item.availability !== 'available'}>
                    <FolderOpen size={15} />定位原件
                  </button>
                </div>
              </article>;
            })}
          </div> : <div className="pm-empty"><Archive size={28} /><strong>{activeTab === 'pending' ? '没有需要确认的资料' : '当前筛选下没有资料'}</strong>
            <span>{activeTab === 'pending' ? '采用、分类、来源和消化状态都已处理。' : '可调整搜索条件，或先扫描项目工作空间。'}</span></div>}

        <div className="pm-apply" aria-live="polite">
          <div><strong>{selectedVisible.length ? `已选择 ${selectedVisible.length} 份资料` : '选择资料后确认分类与采用'}</strong>
            <span>{selectedWithoutCategory.length
              ? `其中 ${selectedWithoutCategory.length} 份尚无可用分类，请先选择分类或只选择目录已识别资料。`
              : '主操作会批量保存分类并确认采用；已在正确目录的原件不会移动。'}</span></div>
          {lastOperationId && <button type="button" className="secondary" onClick={() => void undoLastOperation()} disabled={busy}>
            <RotateCcw size={16} />撤销上次分类</button>}
          <button type="button" className="secondary" onClick={() => void applySelected(false)} disabled={!selectedVisible.length || selectedWithoutCategory.length > 0 || busy || project.status === 'sealed'}>
            <ShieldCheck size={17} />{busy ? '正在处理…' : '仅保存分类'}
          </button>
          <button type="button" className="primary" onClick={() => void applySelected(true)} disabled={!selectedVisible.length || selectedWithoutCategory.length > 0 || busy || project.status === 'sealed'}>
            <CheckCircle2 size={17} />{busy ? '正在处理…' : '确认分类并采用'}
          </button>
        </div>
      </>}

      {activeTab === 'knowledge' && <div className="pm-relations">
        {view.knowledge.map((item) => <article key={item.knowledgeId}><div className="pm-relation-icon"><BookOpen size={19} /></div><div>
          <strong>{item.title}</strong><small>{item.relativePath}</small><p>{item.sources.length ? `由 ${item.sources.length} 个固定资料版本生成` : '尚未登记固定来源'}</p>
          <div className="pm-source-links">{item.sources.map((source) => <span key={`${source.materialId}:${source.version}`}>{materialById.get(source.materialId)?.title || '已登记资料'} · v{source.version}</span>)}</div>
        </div></article>)}
        {!view.knowledge.length && <div className="pm-empty"><BookOpen size={28} /><strong>尚无已登记项目知识</strong><span>资料被采用并完成消化后，会在这里显示固定来源关系。</span></div>}
      </div>}

      {activeTab === 'contributions' && <div className="pm-relations">
        {view.contributions.map((item, index) => <article key={`${item.studentId}:${index}`}><div className="pm-relation-icon"><Users size={19} /></div><div>
          <strong>{item.ability || '待确认贡献能力'}</strong><small>学生 {item.studentId} · {item.status === 'verified' ? '已核验' : '待核验'} · {item.sourceStatus === 'fixed' ? '固定版本证据' : '来源待补充'}</small>
          <p>{item.observation || '尚未填写贡献说明。'}</p><div className="pm-source-links">{item.sources.map((source) => <span key={`${source.materialId}:${source.version}`}>{materialById.get(source.materialId)?.title || '已登记资料'} · v{source.version}</span>)}</div>
        </div></article>)}
        {!view.contributions.length && <div className="pm-empty"><Users size={28} /><strong>尚无贡献证据记录</strong><span>贡献证据必须绑定固定资料版本，不能仅凭项目参与关系生成。</span></div>}
      </div>}

      {results.length > 0 && <div className="pm-results"><strong>本次处理结果</strong>{results.map((item) => <span className={item.ok ? 'ok' : 'failed'} key={item.materialId}>
        {item.ok ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}{materialById.get(item.materialId)?.title || item.materialId}：{item.ok ? (item.unchanged ? '分类未变化' : '已应用') : (resultLabel[item.code || ''] || item.code || '未处理')}
      </span>)}</div>}
      {message && <div className="pm-message" role="status">{message}</div>}
    </section>
  );
}
