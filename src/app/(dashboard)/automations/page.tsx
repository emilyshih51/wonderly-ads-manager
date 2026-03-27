'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/dropdown';
import { Skeleton } from '@/components/ui/skeleton';
import { SlidePanel } from '@/components/data/slide-panel';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Plus,
  Save,
  Trash2,
  Zap,
  Play,
  Pause,
  ArrowLeft,
  X,
  Eye,
  Loader2,
  Settings2,
  Check,
  Activity,
  Bell,
  Copy,
  ArrowRight,
  Wand2,
  RotateCcw,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import {
  useRules,
  useSaveRule,
  useDeleteRule,
  useToggleRule,
} from '@/lib/queries/automations/use-rules';
import { useAutomationHistory, useLogHistory } from '@/lib/queries/automations/use-history';
import { createLogger } from '@/services/logger';
import { CampaignSearch } from '@/components/automations/campaign-search';
import { AdSetSearch } from '@/components/automations/adset-search';
import {
  configToNodes,
  nodesToConfig,
  parseCopilotInput,
  METRIC_OPTIONS,
} from '@/lib/automation-config';
import type { RuleConfig, Condition } from '@/lib/automation-config';
import type { AutomationNode, AutomationEdge } from '@/types';
import { cn } from '@/lib/utils';

import { useTranslations } from 'next-intl';

const logger = createLogger('Automations');

/* ─────────── Types ─────────── */

interface TestResultEntry {
  entity_name: string;
  action: string;
  metrics?: {
    spend?: number;
    results?: number;
    cost_per_result?: number | string;
  };
  warning?: string;
  error?: string;
  slack_sent?: boolean;
  slack_channel?: string;
  duplicated_ad_id?: string;
}

interface TestResult {
  error?: string;
  matched?: number;
  results?: TestResultEntry[];
}

interface Rule {
  id: string;
  name: string;
  is_active: boolean;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  config?: RuleConfig;
}

interface PreviewAd {
  ad_id: string;
  ad_name: string;
  adset_id: string;
  campaign_id: string;
  spend: string;
  results: number;
  cpa: string;
  impressions: number;
  clicks: number;
  ctr: string;
}

/* ─────────── Constants ─────────── */

const OPERATOR_OPTIONS = [
  { labelKey: 'operators.gt', value: '>' },
  { labelKey: 'operators.lt', value: '<' },
  { labelKey: 'operators.gte', value: '>=' },
  { labelKey: 'operators.lte', value: '<=' },
  { labelKey: 'operators.eq', value: '==' },
];

const DATE_PRESET_OPTIONS = [
  { labelKey: 'datePresets.today', value: 'today' },
  { labelKey: 'datePresets.yesterday', value: 'yesterday' },
  { labelKey: 'datePresets.last3d', value: 'last_3d' },
  { labelKey: 'datePresets.last7d', value: 'last_7d' },
  { labelKey: 'datePresets.last14d', value: 'last_14d' },
  { labelKey: 'datePresets.last30d', value: 'last_30d' },
];

const SCHEDULE_OPTIONS = [
  { labelKey: 'schedules.5min', value: '5min' },
  { labelKey: 'schedules.15min', value: '15min' },
  { labelKey: 'schedules.hourly', value: 'hourly' },
  { labelKey: 'schedules.6hours', value: '6hours' },
  { labelKey: 'schedules.daily', value: 'daily' },
];

const SCHEDULE_LABEL_KEYS: Record<string, string> = {
  '5min': 'scheduleLabels.5min',
  '15min': 'scheduleLabels.15min',
  hourly: 'scheduleLabels.hourly',
  '6hours': 'scheduleLabels.6hours',
  daily: 'scheduleLabels.daily',
};

const DEFAULT_CONFIG: RuleConfig = {
  entity_type: 'ad',
  campaign_id: '',
  campaign_name: '',
  adset_filter: 'all',
  adset_name: '',
  schedule: 'hourly',
  date_preset: 'last_7d',
  conditions: [{ id: 'c1', metric: 'spend', operator: '>=', threshold: '' }],
  action_type: 'pause',
  target_adset_id: '',
  target_adset_name: '',
  also_notify_slack: false,
  slack_channel: '',
  slack_message: '',
};

/* ─────────── Templates ─────────── */

interface Template {
  id: string;
  nameKey: string;
  descriptionKey: string;
  icon: string;
  category: 'protect' | 'optimize';
  config: RuleConfig;
}

const TEMPLATES: Template[] = [
  {
    id: 'pause-zero-results',
    nameKey: 'templates.pauseZeroResults',
    descriptionKey: 'templates.pauseZeroResultsDesc',
    icon: '🛡️',
    category: 'protect',
    config: {
      ...DEFAULT_CONFIG,
      conditions: [
        { id: 'c1', metric: 'spend', operator: '>=', threshold: '30' },
        { id: 'c2', metric: 'results', operator: '==', threshold: '0' },
      ],
      action_type: 'pause',
      also_notify_slack: true,
      slack_channel: '',
    },
  },
  {
    id: 'pause-high-cpa',
    nameKey: 'templates.pauseHighCpa',
    descriptionKey: 'templates.pauseHighCpaDesc',
    icon: '💰',
    category: 'protect',
    config: {
      ...DEFAULT_CONFIG,
      conditions: [
        { id: 'c1', metric: 'spend', operator: '>=', threshold: '30' },
        { id: 'c2', metric: 'cost_per_result', operator: '>=', threshold: '25' },
      ],
      action_type: 'pause',
      also_notify_slack: true,
      slack_channel: '',
    },
  },
  {
    id: 'promote-low-cpa-3',
    nameKey: 'templates.promoteLowCpa3',
    descriptionKey: 'templates.promoteLowCpa3Desc',
    icon: '🚀',
    category: 'optimize',
    config: {
      ...DEFAULT_CONFIG,
      conditions: [
        { id: 'c1', metric: 'cost_per_result', operator: '<=', threshold: '15' },
        { id: 'c2', metric: 'results', operator: '>=', threshold: '3' },
      ],
      action_type: 'promote',
      also_notify_slack: true,
      slack_channel: '',
    },
  },
  {
    id: 'promote-low-cpa-5',
    nameKey: 'templates.promoteLowCpa5',
    descriptionKey: 'templates.promoteLowCpa5Desc',
    icon: '🚀',
    category: 'optimize',
    config: {
      ...DEFAULT_CONFIG,
      conditions: [
        { id: 'c1', metric: 'cost_per_result', operator: '<=', threshold: '20' },
        { id: 'c2', metric: 'results', operator: '>=', threshold: '5' },
      ],
      action_type: 'promote',
      also_notify_slack: true,
      slack_channel: '',
    },
  },
];

/* ─────────── Copilot Card Component ─────────── */

function CopilotCard({ onSubmit }: { onSubmit: (input: string) => void }) {
  const t = useTranslations('automations');
  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = () => {
    if (!input.trim()) return;
    setIsSubmitting(true);
    setTimeout(() => {
      onSubmit(input);
      setInput('');
      setIsSubmitting(false);
    }, 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSubmit();
    }
  };

  return (
    <Card className="relative overflow-hidden p-6">
      <div className="absolute top-0 right-0 -mt-20 -mr-20 h-40 w-40 rounded-full bg-[var(--color-primary)]/5" />
      <div className="relative z-10">
        <div className="mb-4 flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-[var(--color-primary)]" />
          <h3 className="text-sm font-semibold text-[var(--color-foreground)]">{t('copilot')}</h3>
          <span className="rounded bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-primary)]">
            {t('aiBeta')}
          </span>
        </div>
        <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">{t('copilotHelp')}</p>
        <div className="space-y-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('copilotPlaceholder')}
            disabled={isSubmitting}
            className="h-24 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:border-transparent focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={!input.trim() || isSubmitting}
              className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {t('building')}
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-3.5 w-3.5" />
                  {t('startBuilding')}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ─────────── Main Component ─────────── */

export default function AutomationsPage() {
  const t = useTranslations('automations');
  const tCommon = useTranslations('common');
  const tMetrics = useTranslations('metrics');
  const { data: rules = [], isLoading: rulesLoading } = useRules();
  const { data: activityLog = [] } = useAutomationHistory();
  const saveRule = useSaveRule();
  const deleteRule = useDeleteRule();
  const toggleRule = useToggleRule();
  const logHistory = useLogHistory();

  // List view tab
  const [listTab, setListTab] = useState<'rules' | 'templates' | 'activityLog'>('rules');

  // Editor panel
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [config, setConfig] = useState<RuleConfig>({ ...DEFAULT_CONFIG });

  // Step state
  const [openStep, setOpenStep] = useState<number>(1);

  // Preview state
  const [previewAds, setPreviewAds] = useState<PreviewAd[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  // Test state
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestResult | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testSetupOpen, setTestSetupOpen] = useState(false);
  const [testChannel, setTestChannel] = useState('');
  const [useHistoryData, setUseHistoryData] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedEntityIdx, setSelectedEntityIdx] = useState<number | null>(null);

  // Run Now state
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<TestResult | null>(null);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [confirmRunRule, setConfirmRunRule] = useState<Rule | null>(null);

  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  /* ─── API ─── */
  const handleSave = async () => {
    try {
      const { nodes, edges } = configToNodes(config);

      await saveRule.mutateAsync({
        ...(selectedRule && { id: selectedRule.id }),
        name: ruleName,
        is_active: selectedRule?.is_active ?? false,
        nodes,
        edges,
      });
      setEditorOpen(false);
    } catch (err) {
      logger.error('Save failed', err);
    }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      await deleteRule.mutateAsync(ruleId);
      if (selectedRule?.id === ruleId) setSelectedRule(null);
    } catch (err) {
      logger.error('Delete failed', err);
    }
  };

  const handleToggle = async (rule: Rule) => {
    try {
      await toggleRule.mutateAsync({ id: rule.id, is_active: !rule.is_active });
    } catch (err) {
      logger.error('Toggle failed', err);
    }
  };

  const openEditor = (opts: { rule?: Rule; config?: RuleConfig; name?: string }) => {
    setSelectedRule(opts.rule ?? null);
    setRuleName(opts.name ?? t('newAutomation'));
    setConfig(opts.config ?? { ...DEFAULT_CONFIG });
    setOpenStep(1);
    setPreviewLoaded(false);
    setPreviewAds([]);
    setEditorOpen(true);
  };

  const applyTemplate = (template: Template) =>
    openEditor({ config: { ...template.config }, name: t(template.nameKey) });

  const editRule = (rule: Rule) =>
    openEditor({ rule, config: nodesToConfig(rule.nodes), name: rule.name });

  const newBlank = () => openEditor({});

  const useCopilot = (input: string) => {
    const { config: parsedConfig, ruleName: parsedName } = parseCopilotInput(input);

    openEditor({ config: { ...DEFAULT_CONFIG, ...parsedConfig }, name: parsedName });
  };

  /* ─── Preview Matching Ads ─── */
  const loadPreview = async () => {
    setPreviewLoading(true);

    try {
      const condParam = config.conditions
        .filter((c) => c.threshold)
        .map((c) => ({ metric: c.metric, operator: c.operator, threshold: c.threshold }));

      const params = new URLSearchParams({
        type: 'preview',
        date_preset: config.date_preset || 'today',
        conditions: JSON.stringify(condParam),
      });

      if (config.campaign_id) {
        // Pass first campaign ID for preview — preview shows a sample of matching ads
        const firstCampaignId = config.campaign_id.split(',').filter(Boolean)[0];

        if (firstCampaignId) params.set('campaign_id', firstCampaignId);
      }

      const res = await fetch(`/api/automations/search?${params}`);
      const data = await res.json();

      setPreviewAds(data.data || []);
      setPreviewTotal(data.total_ads || 0);
      setPreviewLoaded(true);
    } catch (err) {
      logger.error('Preview failed', err);
    } finally {
      setPreviewLoading(false);
    }
  };

  /* ─── Test Workflow ─── */
  const handleTestWorkflow = async () => {
    setTestSetupOpen(false);
    setTesting(true);
    setTestResults(null);

    try {
      const { nodes, edges } = configToNodes(config);
      const payload: Record<string, unknown> = {
        rule: { name: ruleName, is_active: true, nodes, edges },
        send_slack: true,
      };

      if (testChannel) {
        payload.test_channel = testChannel;
      }

      if (useHistoryData && selectedRunId && selectedEntityIdx !== null) {
        const selectedRun = activityLog.find((run) => run.id === selectedRunId);

        if (selectedRun && selectedRun.results[selectedEntityIdx]) {
          const selectedEntity = selectedRun.results[selectedEntityIdx];

          payload.test_data = {
            entity_name: selectedEntity.entity_name || 'Sample Ad',
            spend: selectedEntity.metrics?.spend || 0,
            results: selectedEntity.metrics?.results || 0,
            clicks: 0,
            impressions: 0,
            ctr: 0,
          };
        }
      }

      const res = await fetch('/api/automations/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      setTestResults(data);
      setTestDialogOpen(true);
      await logHistory.mutateAsync({
        rule_name: ruleName,
        type: 'test',
        matched: data.matched || 0,
        results: data.results || [],
      });
    } catch (err) {
      setTestResults({ error: String(err) });
      setTestDialogOpen(true);
    } finally {
      setTesting(false);
    }
  };

  /* ─── Run Now (live execution) ─── */
  const handleRunNow = async (rule: Rule) => {
    setRunningRuleId(rule.id);
    setRunResults(null);
    setConfirmRunRule(null);

    try {
      const res = await fetch('/api/automations/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule: { name: rule.name, is_active: true, nodes: rule.nodes, edges: rule.edges },
          send_slack: true,
          live: true,
        }),
      });
      const data = await res.json();

      setRunResults(data);
      setRunDialogOpen(true);
      await logHistory.mutateAsync({
        rule_name: rule.name,
        type: 'live',
        matched: data.matched || 0,
        results: data.results || [],
      });
    } catch (err) {
      setRunResults({ error: String(err) });
      setRunDialogOpen(true);
    } finally {
      setRunningRuleId(null);
    }
  };

  /* ─── Rollback ─── */
  const handleRollback = async (eventId: string, results: Array<Record<string, unknown>>) => {
    setRollingBackId(eventId);

    try {
      await fetch('/api/automations/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results }),
      });
    } catch (err) {
      logger.error('Rollback failed', err);
    } finally {
      setRollingBackId(null);
    }
  };

  /* ─── Config helpers ─── */
  const updateConfig = (partial: Partial<RuleConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
    setPreviewLoaded(false);
  };

  const addCondition = () => {
    updateConfig({
      conditions: [
        ...config.conditions,
        { id: `c${Date.now()}`, metric: 'spend', operator: '>=', threshold: '' },
      ],
    });
  };

  const updateCondition = (id: string, updates: Partial<Condition>) => {
    updateConfig({
      conditions: config.conditions.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    });
  };

  const removeCondition = (id: string) => {
    if (config.conditions.length <= 1) return;
    updateConfig({ conditions: config.conditions.filter((c) => c.id !== id) });
  };

  /* ─── Step completeness checks ─── */
  const isStep1Complete = !!config.campaign_id.split(',').filter(Boolean).length;
  const isStep2Complete =
    config.conditions.length > 0 && config.conditions.every((c) => c.threshold !== '');
  const isStep3Complete =
    !!config.action_type &&
    (config.action_type !== 'promote' || !!config.target_adset_id) &&
    (config.action_type !== 'adjust_budget' || (config.adjust_amount ?? 0) > 0);

  /* ─── Rule summary for list ─── */
  const getRuleSummary = (rule: Rule) => nodesToConfig(rule.nodes);

  const adjustAmountType = config.adjust_amount_type ?? 'percent';

  /* ─────────── RENDER ─────────── */
  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 sm:px-6 md:px-8">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-[var(--color-foreground)] sm:text-lg">
            {t('title')}
          </h1>
          <p className="mt-0.5 hidden text-xs text-[var(--color-muted-foreground)] sm:block">
            {t('description')}
          </p>
        </div>
        <Button size="sm" onClick={newBlank} className="h-8 shrink-0">
          <Plus className="mr-1 h-3.5 w-3.5" /> {t('newRule')}
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 sm:px-6 md:px-8">
        {(['rules', 'templates', 'activityLog'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setListTab(tab)}
            className={cn(
              '-mb-px border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              listTab === tab
                ? 'border-[var(--color-foreground)] text-[var(--color-foreground)]'
                : 'border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
            )}
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* List content */}
      <div className="flex-1 overflow-y-auto">
        {rulesLoading ? (
          <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 md:px-8">
            <div className="space-y-8">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-72" />
                    </div>
                  </div>
                  <Skeleton className="mt-4 h-10 w-full rounded-lg" />
                </CardContent>
              </Card>
              <div>
                <Skeleton className="mb-4 h-3 w-24" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i} className="flex items-start gap-3 p-4">
                      <Skeleton className="mt-0.5 h-5 w-5 rounded" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
              <div>
                <Skeleton className="mb-4 h-3 w-32" />
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="mb-2 flex items-center gap-4 p-4">
                    <Skeleton className="h-7 w-7 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="h-4 w-12 rounded" />
                      </div>
                      <Skeleton className="h-3 w-56" />
                    </div>
                    <div className="flex gap-1">
                      <Skeleton className="h-7 w-16 rounded-md" />
                      <Skeleton className="h-7 w-7 rounded-md" />
                      <Skeleton className="h-7 w-7 rounded-md" />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 md:px-8">
            {/* ─── RULES TAB ─── */}
            {listTab === 'rules' && (
              <div className="space-y-2">
                {rules.length === 0 ? (
                  <Card className="border-dashed bg-[var(--color-muted)] py-12 text-center">
                    <Zap className="mx-auto mb-3 h-8 w-8 text-[var(--color-muted-foreground)]" />
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      {t('noRulesYet')}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                      {t('pickTemplate')}
                    </p>
                  </Card>
                ) : (
                  rules.map((rule) => {
                    const cfg = getRuleSummary(rule);

                    return (
                      <Card
                        key={rule.id}
                        className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5"
                      >
                        <Switch
                          checked={rule.is_active}
                          onCheckedChange={() => handleToggle(rule)}
                          aria-label={rule.is_active ? t('pauseRule') : t('enableRule')}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2.5">
                            <p
                              className={`text-sm font-semibold ${rule.is_active ? 'text-[var(--color-foreground)]' : 'text-[var(--color-muted-foreground)]'}`}
                            >
                              {rule.name}
                            </p>
                            <span
                              className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${
                                rule.is_active
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                                  : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
                              }`}
                            >
                              {rule.is_active ? t('ruleActive') : t('ruleOff')}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                            {cfg.campaign_name && (
                              <span className="max-w-[300px] truncate">
                                {cfg.campaign_name.split(',').filter(Boolean).length > 1
                                  ? `${cfg.campaign_name.split(',').filter(Boolean).length} campaigns`
                                  : cfg.campaign_name}
                              </span>
                            )}
                            {cfg.adset_name && cfg.adset_filter !== 'all' && (
                              <>
                                <span>·</span>
                                <span className="max-w-[200px] truncate">{cfg.adset_name}</span>
                              </>
                            )}
                            {cfg.campaign_name && <span>·</span>}
                            <span>
                              {t(SCHEDULE_LABEL_KEYS[cfg.schedule] || 'scheduleLabels.hourly')}
                            </span>
                            <span>·</span>
                            <span className="capitalize">{cfg.action_type}</span>
                            {cfg.slack_channel && (
                              <>
                                <span>·</span>
                                <span>{cfg.slack_channel}</span>
                              </>
                            )}
                          </div>
                          {cfg.conditions.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {cfg.conditions.map((c, i) => {
                                const labelKey = METRIC_OPTIONS.find(
                                  (m) => m.value === c.metric
                                )?.labelKey;
                                const metricLabel = labelKey ? tCommon(labelKey) : c.metric;

                                return (
                                  <span key={c.id} className="flex items-center gap-1.5">
                                    {i > 0 && (
                                      <span className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
                                        AND
                                      </span>
                                    )}
                                    <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-0.5 text-[11px] text-[var(--color-foreground)]">
                                      {metricLabel}{' '}
                                      <span className="font-mono text-[var(--color-muted-foreground)]">
                                        {c.operator}
                                      </span>{' '}
                                      <span className="font-medium">{c.threshold}</span>
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 sm:shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => setConfirmRunRule(rule)}
                            disabled={runningRuleId === rule.id}
                          >
                            {runningRuleId === rule.id ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="mr-1 h-3 w-3" />
                            )}
                            <span className="hidden sm:inline">
                              {runningRuleId === rule.id ? t('running') : t('runNow')}
                            </span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => editRule(rule)}
                            title={t('editRule')}
                          >
                            <Settings2 className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleDelete(rule.id)}
                            title={t('deleteRule')}
                          >
                            <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-red-400" />
                          </Button>
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>
            )}

            {/* ─── TEMPLATES TAB ─── */}
            {listTab === 'templates' && (
              <div className="space-y-8">
                {(['protect', 'optimize'] as const).map((category) => {
                  const categoryTemplates = TEMPLATES.filter((tmpl) => tmpl.category === category);
                  const isProtect = category === 'protect';

                  return (
                    <div key={category}>
                      <div className="mb-4 flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-muted)] text-xs">
                          {isProtect ? '🛡️' : '🚀'}
                        </span>
                        <h2 className="text-xs font-semibold tracking-wider text-[var(--color-muted-foreground)] uppercase">
                          {isProtect ? t('categoryProtect') : t('categoryOptimize')}
                        </h2>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {categoryTemplates.map((tmpl) => (
                          <div
                            key={tmpl.id}
                            className="group flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm transition-all hover:border-[var(--color-primary)]/40 hover:shadow-md"
                          >
                            <div className="mb-3 flex items-start gap-5">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-muted)] text-xl">
                                {tmpl.icon}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-[var(--color-foreground)]">
                                  {t(tmpl.nameKey)}
                                </p>
                                <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                                  {t(tmpl.descriptionKey)}
                                </p>
                              </div>
                            </div>
                            <div className="mt-auto pt-3">
                              <Button
                                variant={isProtect ? 'outline-danger' : 'outline-success'}
                                size="sm"
                                className="w-full"
                                onClick={() => applyTemplate(tmpl)}
                              >
                                {t('useTemplate')} <ArrowRight className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <CopilotCard onSubmit={useCopilot} />
              </div>
            )}

            {/* ─── ACTIVITY LOG TAB ─── */}
            {listTab === 'activityLog' && (
              <div>
                {activityLog.length === 0 ? (
                  <Card className="border-dashed bg-[var(--color-muted)] py-8 text-center">
                    <Activity className="mx-auto mb-2 h-8 w-8 text-[var(--color-muted-foreground)]" />
                    <p className="text-sm text-[var(--color-muted-foreground)]">{t('noRunsYet')}</p>
                    <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                      {t('testOrActivate')}
                    </p>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {activityLog.map((event) => {
                      const date = new Date(event.timestamp);
                      const timeStr = date.toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      });
                      const isTest = event.type === 'test';

                      return (
                        <Card key={event.id} className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  isTest
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-emerald-50 text-emerald-700'
                                }`}
                              >
                                {isTest ? t('test') : t('live')}
                              </span>
                              <p className="text-sm font-medium text-[var(--color-foreground)]">
                                {event.rule_name}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {!isTest &&
                                event.results?.some((r) =>
                                  r.action
                                    ? ['paused', 'activated', 'promoted'].includes(r.action)
                                    : false
                                ) && (
                                  <button
                                    onClick={() => handleRollback(event.id, event.results || [])}
                                    disabled={rollingBackId === event.id}
                                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-50"
                                    title={t('undoActions')}
                                  >
                                    {rollingBackId === event.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <RotateCcw className="h-3 w-3" />
                                    )}
                                    {t('undo')}
                                  </button>
                                )}
                              <p className="text-xs text-[var(--color-muted-foreground)]">
                                {timeStr}
                              </p>
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                            {event.matched === 0 ? (
                              <p>{t('noAdsMatched')}</p>
                            ) : (
                              <div className="space-y-1.5">
                                <p>
                                  <span className="font-medium text-[var(--color-foreground)]">
                                    {event.matched}
                                  </span>{' '}
                                  {t('adsMatched', { count: event.matched })}
                                </p>
                                {event.results?.map((r, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center justify-between border-l-2 border-[var(--color-border)] pl-3"
                                  >
                                    <span className="truncate text-[var(--color-foreground)]">
                                      {r.entity_name}
                                    </span>
                                    <div className="ml-2 flex flex-shrink-0 items-center gap-2">
                                      <span className="text-[var(--color-muted-foreground)]">
                                        ${r.metrics?.spend?.toFixed?.(2) || r.metrics?.spend || '0'}{' '}
                                        · {r.metrics?.results ?? 0} {tMetrics('results')}
                                      </span>
                                      <span
                                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                          r.action?.includes('pause') ||
                                          r.action?.includes('would_pause')
                                            ? 'bg-red-50 text-red-600'
                                            : r.action?.includes('promote') ||
                                                r.action?.includes('would_promote')
                                              ? 'bg-emerald-50 text-emerald-600'
                                              : 'bg-blue-50 text-blue-600'
                                        }`}
                                      >
                                        {r.action?.replace('would_', '')}
                                      </span>
                                      {r.slack_sent && (
                                        <span className="text-[10px] text-emerald-500">
                                          {t('slackSent')}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── EDITOR SLIDE PANEL ─── */}
      <SlidePanel
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={selectedRule ? t('saveRule') : t('newRule')}
        width="780px"
      >
        <div className="flex h-full flex-col">
          {/* Rule name */}
          <div className="mb-6 shrink-0">
            <label className="text-xs font-semibold tracking-wider text-[var(--color-muted-foreground)] uppercase">
              {t('ruleName')}
            </label>
            <Input
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              className="mt-2 h-10 text-base font-medium"
              placeholder={t('ruleNamePlaceholder')}
            />
          </div>

          {/* Mobile step indicator (horizontal) */}
          <div className="mb-4 flex shrink-0 items-center gap-0 sm:hidden">
            {[
              { step: 1, label: t('stepTarget'), complete: isStep1Complete },
              { step: 2, label: t('stepConditions'), complete: isStep2Complete },
              { step: 3, label: t('stepAction'), complete: isStep3Complete },
            ].map(({ step, label, complete }, idx) => (
              <div key={step} className="flex flex-1 items-center">
                <button
                  onClick={() => setOpenStep(step)}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <div
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                      openStep === step
                        ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                        : complete
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
                    )}
                  >
                    {complete && openStep !== step ? <Check className="h-3.5 w-3.5" /> : step}
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-medium',
                      openStep === step
                        ? 'text-[var(--color-foreground)]'
                        : 'text-[var(--color-muted-foreground)]'
                    )}
                  >
                    {label}
                  </span>
                </button>
                {idx < 2 && <div className="mx-1 h-px w-6 shrink-0 bg-[var(--color-border)]" />}
              </div>
            ))}
          </div>

          {/* Stepper + content */}
          <div className="flex min-h-0 flex-1 gap-6">
            {/* Left stepper rail — desktop only */}
            <div className="hidden w-36 shrink-0 flex-col gap-1 pt-1 sm:flex">
              {[
                { step: 1, label: t('stepTarget'), complete: isStep1Complete },
                { step: 2, label: t('stepConditions'), complete: isStep2Complete },
                { step: 3, label: t('stepAction'), complete: isStep3Complete },
              ].map(({ step, label, complete }) => (
                <button
                  key={step}
                  onClick={() => setOpenStep(step)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                    openStep === step
                      ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                      : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                      complete
                        ? openStep === step
                          ? 'bg-emerald-400 text-white'
                          : 'bg-emerald-100 text-emerald-700'
                        : openStep === step
                          ? 'bg-[var(--color-primary-foreground)]/20 text-[var(--color-primary-foreground)]'
                          : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
                    )}
                  >
                    {complete ? <Check className="h-3 w-3" /> : step}
                  </div>
                  <span className="font-medium">{label}</span>
                </button>
              ))}
            </div>

            {/* Right content area */}
            <div className="flex-1 overflow-y-auto pr-1">
              {/* ─── STEP 1: Target ─── */}
              {openStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                      {t('entityLevel')}
                    </label>
                    <div className="mt-2 flex gap-2">
                      {['ad', 'adset', 'campaign'].map((type) => (
                        <button
                          key={type}
                          onClick={() => updateConfig({ entity_type: type })}
                          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                            config.entity_type === type
                              ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                              : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:border-[var(--color-primary)]/50'
                          }`}
                        >
                          {type === 'ad'
                            ? tCommon('ads')
                            : type === 'adset'
                              ? tCommon('adSets')
                              : tCommon('campaigns')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                      {tCommon('campaign')}
                    </label>
                    <div className="mt-2">
                      <CampaignSearch
                        value={config.campaign_id}
                        displayName={config.campaign_name}
                        onChange={(id, name) =>
                          updateConfig({ campaign_id: id, campaign_name: name })
                        }
                        placeholder={t('searchByCampaign')}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
                      {t('leaveEmptyAllCampaigns')}
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                      {t('adSet')}
                    </label>
                    <div className="mt-2">
                      <AdSetSearch
                        value={config.adset_filter === 'all' ? '' : config.adset_filter}
                        displayName={config.adset_name}
                        campaignId={config.campaign_id.split(',').filter(Boolean)[0] || undefined}
                        onChange={(id, name) =>
                          updateConfig({
                            adset_filter: id || 'all',
                            adset_name: name,
                          })
                        }
                        placeholder={t('searchByAdSet')}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
                      {t('leaveEmptyAllAdSets')}
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                      {t('checkFrequency')}
                    </label>
                    <Select
                      value={config.schedule}
                      onChange={(value) => updateConfig({ schedule: value })}
                      options={SCHEDULE_OPTIONS.map((o) => ({
                        label: t(o.labelKey),
                        value: o.value,
                      }))}
                      className="mt-2 w-full"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                      {t('performancePeriod')}
                    </label>
                    <Select
                      value={config.date_preset}
                      onChange={(value) => updateConfig({ date_preset: value })}
                      options={DATE_PRESET_OPTIONS.map((o) => ({
                        label: t(o.labelKey),
                        value: o.value,
                      }))}
                      className="mt-2 w-full"
                    />
                    <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
                      {t('timeRangeDesc')}
                    </p>
                  </div>
                </div>
              )}

              {/* ─── STEP 2: Conditions ─── */}
              {openStep === 2 && (
                <div className="space-y-3">
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {t('allConditionsMet')}
                  </p>

                  {config.conditions.map((cond, i) => (
                    <div key={cond.id} className="flex items-start gap-2">
                      {i > 0 && (
                        <span className="mt-2 rounded bg-[var(--color-muted)] px-2 py-1 text-xs font-semibold text-[var(--color-muted-foreground)]">
                          AND
                        </span>
                      )}
                      <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                        <Select
                          value={cond.metric}
                          onChange={(value) => updateCondition(cond.id, { metric: value })}
                          options={METRIC_OPTIONS.map((o) => ({
                            label: tCommon(o.labelKey),
                            value: o.value,
                          }))}
                          className="w-full sm:flex-1"
                        />
                        <div className="flex gap-2">
                          <Select
                            value={cond.operator}
                            onChange={(value) => updateCondition(cond.id, { operator: value })}
                            options={OPERATOR_OPTIONS.map((o) => ({
                              label: t(o.labelKey),
                              value: o.value,
                            }))}
                            className="flex-1 sm:w-48 sm:flex-none"
                          />
                          <Input
                            type="number"
                            value={cond.threshold}
                            onChange={(e) =>
                              updateCondition(cond.id, { threshold: e.target.value })
                            }
                            placeholder={t('value')}
                            className="h-9 w-20 shrink-0"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => removeCondition(cond.id)}
                        className={`mt-2 rounded p-1 hover:bg-[var(--color-muted)] ${config.conditions.length <= 1 ? 'cursor-not-allowed opacity-30' : ''}`}
                        disabled={config.conditions.length <= 1}
                      >
                        <X className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={addCondition}
                    className="mt-1 flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    <Plus className="h-3.5 w-3.5" /> {t('addCondition')}
                  </button>

                  {/* Preview Matching Ads */}
                  <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={loadPreview}
                        disabled={previewLoading || !isStep2Complete}
                      >
                        {previewLoading ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{' '}
                            {tCommon('loading')}
                          </>
                        ) : (
                          <>
                            <Eye className="mr-1.5 h-3.5 w-3.5" /> {t('previewMatchingAds')}
                          </>
                        )}
                      </Button>
                      {previewLoaded && (
                        <span className="text-sm text-[var(--color-muted-foreground)]">
                          <span className="font-semibold text-[var(--color-foreground)]">
                            {previewAds.length}
                          </span>{' '}
                          {t('ofAdsMatch', { total: previewTotal })}
                        </span>
                      )}
                    </div>

                    {previewLoaded && previewAds.length > 0 && (
                      <div className="mt-3 overflow-hidden rounded-lg border border-[var(--color-border)]">
                        <table className="w-full text-xs">
                          <thead className="bg-[var(--color-muted)]">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-[var(--color-muted-foreground)]">
                                {tMetrics('adName')}
                              </th>
                              <th className="px-3 py-2 text-right font-medium text-[var(--color-muted-foreground)]">
                                {tMetrics('spend')}
                              </th>
                              <th className="px-3 py-2 text-right font-medium text-[var(--color-muted-foreground)]">
                                {tMetrics('results')}
                              </th>
                              <th className="px-3 py-2 text-right font-medium text-[var(--color-muted-foreground)]">
                                {tMetrics('cpa')}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-border)]">
                            {previewAds.slice(0, 10).map((ad) => (
                              <tr key={ad.ad_id} className="hover:bg-[var(--color-muted)]">
                                <td className="max-w-[200px] truncate px-3 py-2 text-[var(--color-foreground)]">
                                  {ad.ad_name}
                                </td>
                                <td className="px-3 py-2 text-right text-[var(--color-muted-foreground)]">
                                  ${ad.spend}
                                </td>
                                <td className="px-3 py-2 text-right text-[var(--color-muted-foreground)]">
                                  {ad.results}
                                </td>
                                <td className="px-3 py-2 text-right text-[var(--color-muted-foreground)]">
                                  {ad.cpa === 'N/A' ? '—' : `$${ad.cpa}`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {previewAds.length > 10 && (
                          <div className="border-t border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                            {t('moreAds', { count: previewAds.length - 10 })}
                          </div>
                        )}
                      </div>
                    )}

                    {previewLoaded && previewAds.length === 0 && (
                      <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-4 text-center">
                        <p className="text-sm text-[var(--color-muted-foreground)]">
                          {t('noAdsMatch')}
                        </p>
                        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                          {t('checkThresholds')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ─── STEP 3: Action ─── */}
              {openStep === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                      {t('actionType')}
                    </label>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {[
                        {
                          value: 'pause',
                          label: t('pause'),
                          icon: <Pause className="h-4 w-4" />,
                          desc: t('turnOffAd'),
                        },
                        {
                          value: 'promote',
                          label: t('promote'),
                          icon: <Copy className="h-4 w-4" />,
                          desc: t('pauseDuplicateWinners'),
                        },
                        {
                          value: 'activate',
                          label: t('activate'),
                          icon: <Play className="h-4 w-4" />,
                          desc: t('turnOnAd'),
                        },
                        {
                          value: 'slack_notify',
                          label: t('notifyOnly'),
                          icon: <Bell className="h-4 w-4" />,
                          desc: t('justSendSlack'),
                        },
                        {
                          value: 'adjust_budget',
                          label: t('adjustBudget'),
                          icon:
                            config.adjust_direction === 'decrease' ? (
                              <TrendingDown className="h-4 w-4" />
                            ) : (
                              <TrendingUp className="h-4 w-4" />
                            ),
                          desc: t('adjustBudgetDescription'),
                        },
                      ].map((action) => (
                        <button
                          key={action.value}
                          onClick={() => updateConfig({ action_type: action.value })}
                          className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                            config.action_type === action.value
                              ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                              : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:border-[var(--color-primary)]/50'
                          }`}
                        >
                          {action.icon}
                          <div>
                            <p className="text-sm font-medium">{action.label}</p>
                            <p
                              className={`text-[10px] ${config.action_type === action.value ? 'opacity-70' : 'text-[var(--color-muted-foreground)]'}`}
                            >
                              {action.desc}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {config.action_type === 'promote' && (
                    <div>
                      <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                        {t('targetAdSet')}{' '}
                        <span className="font-normal text-[var(--color-muted-foreground)] normal-case">
                          {t('duplicateWinningAdsHere')}
                        </span>
                      </label>
                      <div className="mt-2">
                        <AdSetSearch
                          value={config.target_adset_id}
                          displayName={config.target_adset_name}
                          onChange={(id, name) =>
                            updateConfig({ target_adset_id: id, target_adset_name: name })
                          }
                          placeholder={t('searchForWinnersAdSet')}
                        />
                      </div>
                    </div>
                  )}

                  {config.action_type === 'adjust_budget' && (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                          {t('direction')}
                        </label>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {(['increase', 'decrease'] as const).map((dir) => (
                            <button
                              key={dir}
                              onClick={() => updateConfig({ adjust_direction: dir })}
                              className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                                (config.adjust_direction ?? 'increase') === dir
                                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                                  : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:border-[var(--color-primary)]/50'
                              }`}
                            >
                              {dir === 'increase' ? (
                                <TrendingUp className="h-3.5 w-3.5" />
                              ) : (
                                <TrendingDown className="h-3.5 w-3.5" />
                              )}
                              {dir === 'increase' ? t('increase') : t('decrease')}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                          {t('amountType')}
                        </label>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {(
                            [
                              { value: 'percent', label: t('percent') },
                              { value: 'fixed', label: t('fixedAmount') },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => updateConfig({ adjust_amount_type: opt.value })}
                              className={`rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                                adjustAmountType === opt.value
                                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                                  : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:border-[var(--color-primary)]/50'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                          {adjustAmountType === 'percent' ? t('percentAmount') : t('dollarAmount')}
                        </label>
                        <div className="relative mt-1">
                          {adjustAmountType === 'fixed' && (
                            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[var(--color-muted-foreground)]">
                              $
                            </span>
                          )}
                          <Input
                            type="number"
                            min={0}
                            value={config.adjust_amount ?? ''}
                            onChange={(e) =>
                              updateConfig({ adjust_amount: parseFloat(e.target.value) || 0 })
                            }
                            className={cn('mt-1 h-9', adjustAmountType === 'fixed' && 'pl-6')}
                            placeholder={t('budgetAmountPlaceholder')}
                          />
                          {adjustAmountType === 'percent' && (
                            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-[var(--color-muted-foreground)]">
                              %
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="border-t border-[var(--color-border)] pt-4">
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <Switch
                        size="sm"
                        checked={config.also_notify_slack}
                        onCheckedChange={(checked) => updateConfig({ also_notify_slack: checked })}
                      />
                      <span className="text-sm font-medium text-[var(--color-foreground)]">
                        {t('sendSlackNotification')}
                      </span>
                    </label>

                    {config.also_notify_slack && (
                      <div className="mt-3 ml-6 space-y-3">
                        <div>
                          <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                            {t('slackChannel')}
                          </label>
                          <Input
                            value={config.slack_channel}
                            onChange={(e) => updateConfig({ slack_channel: e.target.value })}
                            className="mt-1 h-9"
                            placeholder={t('channelPlaceholder')}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                            {t('customMessage')}{' '}
                            <span className="font-normal text-[var(--color-muted-foreground)] normal-case">
                              {tCommon('optional')}
                            </span>
                          </label>
                          <textarea
                            value={config.slack_message}
                            onChange={(e) => updateConfig({ slack_message: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 font-mono text-sm text-[var(--color-foreground)] focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            rows={3}
                            placeholder={t('leaveEmptyDefault')}
                          />
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {[
                              { var: '{rule_name}', label: t('ruleName') },
                              { var: '{action}', label: t('action') },
                              { var: '{entity_name}', label: tMetrics('adName') },
                              { var: '{campaign_name}', label: tMetrics('campaignName') },
                              { var: '{ad_link}', label: t('adLink') },
                              { var: '{spend}', label: tMetrics('spend') },
                              { var: '{results}', label: tMetrics('results') },
                              { var: '{cpa}', label: tMetrics('cpa') },
                              { var: '{clicks}', label: tMetrics('clicks') },
                              { var: '{ctr}', label: tMetrics('ctr') },
                            ].map((v) => (
                              <button
                                key={v.var}
                                type="button"
                                onClick={() =>
                                  updateConfig({
                                    slack_message: (config.slack_message || '') + v.var,
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)]"
                              >
                                <Plus className="h-2.5 w-2.5" />
                                {v.label}
                              </button>
                            ))}
                          </div>

                          {(config.slack_message || previewAds.length > 0) && (
                            <div className="mt-3">
                              <p className="mb-1.5 text-[10px] font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                                {t('messagePreview')}
                              </p>
                              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-sm whitespace-pre-wrap text-[var(--color-foreground)]">
                                {(() => {
                                  const sampleAd = previewAds[0];
                                  const actionVerb =
                                    config.action_type === 'promote'
                                      ? t('promoted')
                                      : config.action_type === 'pause'
                                        ? t('paused2')
                                        : config.action_type === 'activate'
                                          ? t('activated')
                                          : t('notified');
                                  const msg =
                                    config.slack_message ||
                                    `${config.action_type === 'promote' ? '🚀' : '⏸️'} *${ruleName}*\n${actionVerb} ad: ${sampleAd ? sampleAd.ad_name : '<ad name>'}\nSpend: $${sampleAd?.spend || '0.00'} · Results: ${sampleAd?.results ?? 0} · CPA: ${sampleAd?.cpa === 'N/A' ? 'N/A' : `$${sampleAd?.cpa || '0.00'}`}`;

                                  return msg
                                    .replace(/\{rule_name\}/g, ruleName || 'Rule Name')
                                    .replace(/\{action\}/g, actionVerb)
                                    .replace(/\{entity_name\}/g, sampleAd?.ad_name || '<ad name>')
                                    .replace(/\{ad_link\}/g, sampleAd?.ad_name || '<ad name>')
                                    .replace(/\{spend\}/g, `$${sampleAd?.spend || '0.00'}`)
                                    .replace(/\{results\}/g, String(sampleAd?.results ?? 0))
                                    .replace(
                                      /\{cpa\}/g,
                                      sampleAd?.cpa === 'N/A'
                                        ? 'N/A'
                                        : `$${sampleAd?.cpa || '0.00'}`
                                    )
                                    .replace(/\{clicks\}/g, String(sampleAd?.clicks ?? 0))
                                    .replace(/\{ctr\}/g, `${sampleAd?.ctr || '0.00'}%`)
                                    .replace(
                                      /\{campaign_name\}/g,
                                      config.campaign_name
                                        ? config.campaign_name.split(',').filter(Boolean).join(', ')
                                        : '<campaign name>'
                                    );
                                })()}
                              </div>
                              {previewAds.length > 0 && (
                                <p className="mt-1 text-[10px] text-[var(--color-muted-foreground)]">
                                  {t('previewingWith', { name: previewAds[0].ad_name })}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ─── Inline Test Setup ─── */}
          {testSetupOpen && (
            <div className="mt-4 shrink-0 space-y-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-[var(--color-foreground)]">
                  {t('testSetup')}
                </h4>
                <button
                  onClick={() => setTestSetupOpen(false)}
                  className="rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)]">{t('testSetupDesc')}</p>
              <div>
                <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                  {t('testChannel')}
                </label>
                <Input
                  value={testChannel}
                  onChange={(e) => setTestChannel(e.target.value)}
                  className="mt-1 h-9"
                  placeholder={t('testChannelPlaceholder')}
                />
              </div>
              <div className="border-t border-[var(--color-border)] pt-3">
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Switch size="sm" checked={useHistoryData} onCheckedChange={setUseHistoryData} />
                  <span className="text-sm font-medium text-[var(--color-foreground)]">
                    {t('useHistoryData')}
                  </span>
                </label>
                <p className="mt-1 ml-8 text-xs text-[var(--color-muted-foreground)]">
                  {useHistoryData ? t('useHistoryData') : t('useLiveData')}
                </p>
              </div>
              {useHistoryData && (
                <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                  {!activityLog || activityLog.length === 0 ? (
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {t('noHistoryRuns')}
                    </p>
                  ) : (
                    <>
                      <div>
                        <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                          {t('selectRun')}
                        </label>
                        <Select
                          value={selectedRunId || ''}
                          onChange={(val: string) => setSelectedRunId(val)}
                          placeholder={t('selectRun')}
                          options={activityLog.map((run) => {
                            const date = new Date(run.timestamp * 1000).toLocaleString();

                            return {
                              label: `${run.rule_name} — ${date}`,
                              value: run.id,
                            };
                          })}
                        />
                      </div>

                      {selectedRunId && (
                        <>
                          <div>
                            <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                              {t('selectEntity')}
                            </label>
                            <Select
                              value={selectedEntityIdx !== null ? String(selectedEntityIdx) : ''}
                              onChange={(val: string) => setSelectedEntityIdx(parseInt(val))}
                              placeholder={t('selectEntity')}
                              options={
                                activityLog
                                  .find((run) => run.id === selectedRunId)
                                  ?.results.map((entity, idx) => ({
                                    label: `${entity.entity_name || 'Unknown Entity'} — ${entity.action || 'No action'}`,
                                    value: String(idx),
                                  })) ?? []
                              }
                            />
                          </div>

                          {selectedEntityIdx !== null && (
                            <div className="rounded bg-[var(--color-accent)] p-2">
                              <p className="mb-2 text-xs font-medium text-[var(--color-foreground)]">
                                {t('selectedMetrics')}
                              </p>
                              {(() => {
                                const selectedRun = activityLog.find(
                                  (run) => run.id === selectedRunId
                                );
                                const selectedEntity = selectedRun?.results[selectedEntityIdx];

                                return (
                                  <div className="space-y-1 text-xs text-[var(--color-muted-foreground)]">
                                    <div>
                                      <span className="font-medium">
                                        {t('common:spendDollar')}:{' '}
                                      </span>
                                      ${(selectedEntity?.metrics?.spend ?? 0).toFixed(2)}
                                    </div>
                                    <div>
                                      <span className="font-medium">{t('common:results')}: </span>
                                      {selectedEntity?.metrics?.results ?? 0}
                                    </div>
                                    <div>
                                      <span className="font-medium">
                                        {t('common:costPerResult')}:{' '}
                                      </span>
                                      $
                                      {typeof selectedEntity?.metrics?.cost_per_result === 'number'
                                        ? selectedEntity.metrics.cost_per_result.toFixed(2)
                                        : (selectedEntity?.metrics?.cost_per_result ?? 'N/A')}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setTestSetupOpen(false)}>
                  {tCommon('cancel')}
                </Button>
                <Button
                  size="sm"
                  onClick={handleTestWorkflow}
                  disabled={useHistoryData && !selectedRunId}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" /> {t('sendTest')}
                </Button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (openStep > 1 ? setOpenStep(openStep - 1) : setEditorOpen(false))}
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              {openStep === 1 ? tCommon('cancel') : t('back')}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTestChannel(config.slack_channel || '');
                  setTestSetupOpen((prev) => !prev);
                }}
                disabled={testing}
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                {testing ? t('testing') : t('testRule')}
              </Button>
              {openStep < 3 ? (
                <Button
                  size="sm"
                  onClick={() => setOpenStep(openStep + 1)}
                  disabled={openStep === 1 ? !isStep1Complete : !isStep2Complete}
                >
                  {t('continue')} <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button size="sm" onClick={handleSave} disabled={saveRule.isPending}>
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {saveRule.isPending ? t('saving') : t('saveRule')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </SlidePanel>

      {/* ─── Test Results Dialog ─── */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{t('testResults')}</DialogTitle>
            <DialogDescription className="text-xs">{t('testResultsDesc')}</DialogDescription>
          </DialogHeader>
          <div className="mt-2 max-h-[400px] space-y-3 overflow-y-auto">
            {testResults?.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-700">{testResults.error}</p>
              </div>
            ) : testResults?.matched === 0 ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-4 text-center">
                <p className="text-sm font-medium text-[var(--color-muted-foreground)]">
                  {t('noAdsMatched')}
                </p>
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  {t('noAdsMetThresholds')}
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  <span className="font-medium text-[var(--color-foreground)]">
                    {testResults?.matched || 0}
                  </span>{' '}
                  {t('adsWouldBeAffected', { count: testResults?.matched || 0 })}
                </p>
                {testResults?.results?.map((r: TestResultEntry, i: number) => (
                  <div key={i} className="rounded-lg border border-[var(--color-border)] p-3">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
                        {r.entity_name}
                      </p>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                          r.action?.includes('pause')
                            ? 'bg-red-50 text-red-600'
                            : r.action?.includes('promote')
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-blue-50 text-blue-600'
                        }`}
                      >
                        {r.action?.replace('would_', '→ ')}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
                      <span>
                        {tMetrics('spend')}: ${r.metrics?.spend?.toFixed(2)}
                      </span>
                      <span>
                        {tMetrics('results')}: {r.metrics?.results}
                      </span>
                      <span>
                        {tMetrics('cpa')}:{' '}
                        {r.metrics?.cost_per_result === 'N/A'
                          ? 'N/A'
                          : `$${r.metrics?.cost_per_result}`}
                      </span>
                    </div>
                    {r.warning && <p className="mt-1 text-[10px] text-amber-600">{r.warning}</p>}
                    {r.slack_sent && r.slack_channel && (
                      <p className="mt-1 text-[10px] text-emerald-600">
                        {t('slackSentTo', { channel: r.slack_channel })}
                      </p>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={() => setTestDialogOpen(false)}>
              {tCommon('close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Run Now Confirmation Dialog ─── */}
      <Dialog open={!!confirmRunRule} onOpenChange={(open) => !open && setConfirmRunRule(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{t('runRuleNow')}</DialogTitle>
            <DialogDescription className="text-xs">{t('runRuleNowDesc')}</DialogDescription>
          </DialogHeader>
          {confirmRunRule && (
            <div className="mt-2 space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-800">{confirmRunRule.name}</p>
                <p className="mt-1 text-xs text-amber-700">{t('runRuleNowWarning')}</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmRunRule(null)}>
                  {tCommon('cancel')}
                </Button>
                <Button size="sm" onClick={() => handleRunNow(confirmRunRule)}>
                  <Play className="mr-1.5 h-3.5 w-3.5" /> {t('runNow')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Run Results Dialog ─── */}
      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{t('runComplete')}</DialogTitle>
            <DialogDescription className="text-xs">{t('runCompleteDesc')}</DialogDescription>
          </DialogHeader>
          <div className="mt-2 max-h-[400px] space-y-3 overflow-y-auto">
            {runResults?.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-700">{runResults.error}</p>
              </div>
            ) : runResults?.matched === 0 ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-4 text-center">
                <p className="text-sm font-medium text-[var(--color-muted-foreground)]">
                  {t('noAdsMatched')}
                </p>
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  {t('noActionsTaken')}
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  <span className="font-medium text-[var(--color-foreground)]">
                    {runResults?.matched || 0}
                  </span>{' '}
                  {t('adsAffected', { count: runResults?.matched || 0 })}
                </p>
                {runResults?.results?.map((r: TestResultEntry, i: number) => (
                  <div key={i} className="rounded-lg border border-[var(--color-border)] p-3">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
                        {r.entity_name}
                      </p>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                          r.action?.includes('pause')
                            ? 'bg-red-50 text-red-600'
                            : r.action?.includes('promote')
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-blue-50 text-blue-600'
                        }`}
                      >
                        {r.action}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
                      <span>
                        {tMetrics('spend')}: ${r.metrics?.spend?.toFixed(2)}
                      </span>
                      <span>
                        {tMetrics('results')}: {r.metrics?.results}
                      </span>
                      <span>
                        {tMetrics('cpa')}:{' '}
                        {r.metrics?.cost_per_result === 'N/A'
                          ? 'N/A'
                          : `$${r.metrics?.cost_per_result}`}
                      </span>
                    </div>
                    {r.duplicated_ad_id && (
                      <p className="mt-1 text-[10px] text-emerald-600">
                        {t('duplicatedToWinners')}
                      </p>
                    )}
                    {r.slack_sent && r.slack_channel && (
                      <p className="mt-1 text-[10px] text-emerald-600">
                        {t('slackSentTo', { channel: r.slack_channel })}
                      </p>
                    )}
                    {r.error && <p className="mt-1 text-[10px] text-red-600">{r.error}</p>}
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={() => setRunDialogOpen(false)}>
              {tCommon('close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
