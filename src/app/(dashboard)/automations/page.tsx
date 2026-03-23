'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/dropdown';
import { Skeleton } from '@/components/ui/skeleton';
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
  ChevronDown,
  ChevronUp,
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

/* ─────────── Step Component ─────────── */

function StepHeader({
  number,
  title,
  subtitle,
  isOpen,
  onToggle,
  isComplete,
}: {
  number: number;
  title: string;
  subtitle?: string;
  isOpen: boolean;
  onToggle: () => void;
  isComplete: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-[var(--color-muted)]"
    >
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          isComplete
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
        }`}
      >
        {isComplete ? <Check className="h-4 w-4" /> : number}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--color-foreground)]">{title}</p>
        {subtitle && (
          <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{subtitle}</p>
        )}
      </div>
      {isOpen ? (
        <ChevronUp className="h-4 w-4 flex-shrink-0 text-[var(--color-muted-foreground)]" />
      ) : (
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-[var(--color-muted-foreground)]" />
      )}
    </button>
  );
}

/* ─────────── Main Component ─────────── */

/* ─────────── Copilot Card Component ─────────── */

function CopilotCard({ onSubmit }: { onSubmit: (input: string) => void }) {
  const t = useTranslations('automations');
  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = () => {
    if (!input.trim()) return;
    setIsSubmitting(true);
    // Simulate brief processing
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
      {/* Background accent */}
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

  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list');
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [config, setConfig] = useState<RuleConfig>({ ...DEFAULT_CONFIG });

  // Step accordion
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
      setViewMode('list');
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

  const applyTemplate = (template: Template) => {
    setSelectedRule(null);
    setRuleName(t(template.nameKey));
    setConfig({ ...template.config });
    setOpenStep(1);
    setPreviewLoaded(false);
    setPreviewAds([]);
    setViewMode('editor');
  };

  const editRule = (rule: Rule) => {
    setSelectedRule(rule);
    setRuleName(rule.name);
    setConfig(nodesToConfig(rule.nodes));
    setOpenStep(1);
    setPreviewLoaded(false);
    setPreviewAds([]);
    setViewMode('editor');
  };

  const newBlank = () => {
    setSelectedRule(null);
    setRuleName(t('newAutomation'));
    setConfig({ ...DEFAULT_CONFIG });
    setOpenStep(1);
    setPreviewLoaded(false);
    setPreviewAds([]);
    setViewMode('editor');
  };

  const useCopilot = (input: string) => {
    const { config: parsedConfig, ruleName: parsedName } = parseCopilotInput(input);

    setSelectedRule(null);
    setRuleName(parsedName);
    setConfig({ ...DEFAULT_CONFIG, ...parsedConfig });
    setOpenStep(1);
    setPreviewLoaded(false);
    setPreviewAds([]);
    setViewMode('editor');
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

      if (config.campaign_id) params.set('campaign_id', config.campaign_id);

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
    setTesting(true);
    setTestResults(null);

    try {
      const { nodes, edges } = configToNodes(config);
      const res = await fetch('/api/automations/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule: { name: ruleName, is_active: true, nodes, edges },
          send_slack: true,
        }),
      });
      const data = await res.json();

      setTestResults(data);
      setTestDialogOpen(true);

      // Log to activity history
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
          rule: {
            name: rule.name,
            is_active: true,
            nodes: rule.nodes,
            edges: rule.edges,
          },
          send_slack: true,
          live: true, // Actually execute actions
        }),
      });
      const data = await res.json();

      setRunResults(data);
      setRunDialogOpen(true);

      // Log to activity history
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
  const isStep1Complete = !!config.campaign_id;
  const isStep2Complete =
    config.conditions.length > 0 && config.conditions.every((c) => c.threshold !== '');
  const isStep3Complete =
    !!config.action_type && (config.action_type !== 'promote' || !!config.target_adset_id);

  /* ─── Rule summary for list ─── */
  const getRuleSummary = (rule: Rule) => nodesToConfig(rule.nodes);

  /* ─────────── RENDER ─────────── */
  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 sm:px-6 md:px-8">
        <div className="flex items-center gap-2">
          {viewMode === 'editor' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setViewMode('list')}
              className="h-8 w-8 shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-[var(--color-foreground)] sm:text-lg">
              {viewMode === 'list' ? t('title') : selectedRule ? t('saveRule') : t('newRule')}
            </h1>
            <p className="mt-0.5 hidden text-xs text-[var(--color-muted-foreground)] sm:block">
              {viewMode === 'list' ? t('description') : t('conditions')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {viewMode === 'editor' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestWorkflow}
                disabled={testing}
                className="h-8"
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                <span className="hidden sm:inline">{testing ? t('testing') : t('testRule')}</span>
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saveRule.isPending} className="h-8">
                <Save className="mr-1.5 h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {saveRule.isPending ? t('saving') : t('saveRule')}
                </span>
              </Button>
            </>
          )}
          {viewMode === 'list' && (
            <Button size="sm" onClick={newBlank} className="h-8">
              <Plus className="mr-1 h-3.5 w-3.5" /> {t('newRule')}
            </Button>
          )}
        </div>
      </div>

      {/* ─── LIST VIEW ─── */}
      {viewMode === 'list' && (
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
              <div className="space-y-8">
                {/* Copilot */}
                <CopilotCard onSubmit={useCopilot} />

                {/* Templates */}
                <div>
                  <h2 className="mb-4 text-xs font-semibold tracking-wider text-[var(--color-muted-foreground)] uppercase">
                    Starter templates
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {TEMPLATES.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        onClick={() => applyTemplate(tmpl)}
                        className="group flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left shadow-sm transition-all hover:border-[var(--color-primary)]/40 hover:shadow-md"
                      >
                        <span className="mt-0.5 text-lg">{tmpl.icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--color-foreground)]">
                            {t(tmpl.nameKey)}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                            {t(tmpl.descriptionKey)}
                          </p>
                          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] opacity-0 transition-opacity group-hover:opacity-100">
                            {t('useTemplate')} <ArrowRight className="h-3 w-3" />
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Active Rules */}
                <div>
                  <h2 className="mb-4 text-xs font-semibold tracking-wider text-[var(--color-muted-foreground)] uppercase">
                    {t('yourRules')} {rules.length > 0 && `(${rules.length})`}
                  </h2>
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
                    <div className="space-y-2">
                      {rules.map((rule) => {
                        const cfg = getRuleSummary(rule);
                        const condSummary = cfg.conditions
                          .map((c) => {
                            const labelKey = METRIC_OPTIONS.find(
                              (m) => m.value === c.metric
                            )?.labelKey;

                            return `${labelKey ? tCommon(labelKey) : c.metric} ${c.operator} ${c.threshold}`;
                          })
                          .join(' AND ');

                        return (
                          <Card
                            key={rule.id}
                            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4"
                          >
                            <Switch
                              checked={rule.is_active}
                              onCheckedChange={() => handleToggle(rule)}
                              aria-label={rule.is_active ? t('pauseRule') : t('enableRule')}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p
                                  className={`text-sm font-medium ${rule.is_active ? 'text-[var(--color-foreground)]' : 'text-[var(--color-muted-foreground)]'}`}
                                >
                                  {rule.name}
                                </p>
                                <span
                                  className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                    rule.is_active
                                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                                      : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
                                  }`}
                                >
                                  {rule.is_active ? t('ruleActive') : t('ruleOff')}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                                {cfg.campaign_name && (
                                  <span className="max-w-[200px] truncate">
                                    {cfg.campaign_name}
                                  </span>
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
                              {condSummary && (
                                <p className="mt-0.5 truncate text-xs text-[var(--color-muted-foreground)]">
                                  {t('if')}: {condSummary}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 sm:shrink-0">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
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
                                className="h-7 w-7"
                                onClick={() => editRule(rule)}
                                title={t('editRule')}
                              >
                                <Settings2 className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleDelete(rule.id)}
                                title={t('deleteRule')}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-[var(--color-muted-foreground)] hover:text-red-400" />
                              </Button>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Activity Log */}
                <div>
                  <h2 className="mb-4 text-xs font-semibold tracking-wider text-[var(--color-muted-foreground)] uppercase">
                    {t('activityLog')} {activityLog.length > 0 && `(${activityLog.length})`}
                  </h2>
                  {activityLog.length === 0 ? (
                    <Card className="border-dashed bg-[var(--color-muted)] py-8 text-center">
                      <Activity className="mx-auto mb-2 h-8 w-8 text-[var(--color-muted-foreground)]" />
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        {t('noRunsYet')}
                      </p>
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
                                          $
                                          {r.metrics?.spend?.toFixed?.(2) ||
                                            r.metrics?.spend ||
                                            '0'}{' '}
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
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── EDITOR VIEW (Step-by-step form) ─── */}
      {viewMode === 'editor' && (
        <div className="flex-1 overflow-y-auto bg-[var(--color-background)]">
          <div className="mx-auto max-w-2xl space-y-4 px-8 py-6">
            {/* Rule Name */}
            <Card className="p-5">
              <label className="text-xs font-semibold tracking-wider text-[var(--color-muted-foreground)] uppercase">
                {t('ruleName')}
              </label>
              <Input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                className="mt-2 h-10 text-base font-medium"
                placeholder={t('ruleNamePlaceholder')}
              />
            </Card>

            {/* ─── STEP 1: Apply rule to ─── */}
            <Card className="overflow-hidden">
              <StepHeader
                number={1}
                title={t('applyRuleTo')}
                subtitle={
                  config.campaign_name
                    ? `${config.entity_type === 'ad' ? t('allAds') : config.entity_type === 'adset' ? t('allAdSets') : tCommon('campaigns')} ${t('inCampaign', { name: config.campaign_name })}`
                    : t('selectCampaignAndEntity')
                }
                isOpen={openStep === 1}
                onToggle={() => setOpenStep(openStep === 1 ? 0 : 1)}
                isComplete={isStep1Complete}
              />
              {openStep === 1 && (
                <div className="space-y-4 border-t border-[var(--color-border)] px-5 pt-4 pb-5">
                  {/* Entity type */}
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
                              ? 'border-[var(--color-foreground)] bg-[var(--color-foreground)] text-[var(--color-background)]'
                              : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:border-[var(--color-border)]'
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

                  {/* Campaign selector */}
                  <div>
                    <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                      {tCommon('campaign')}
                    </label>
                    <div className="mt-2">
                      <CampaignSearch
                        value={config.campaign_id}
                        displayName={config.campaign_name}
                        onChange={(id, name) =>
                          updateConfig({
                            campaign_id: id,
                            campaign_name: name,
                          })
                        }
                        placeholder={t('searchByCampaign')}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
                      {t('leaveEmptyAllCampaigns')}
                    </p>
                  </div>

                  {/* Schedule */}
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

                  {/* Performance period */}
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

                  <Button
                    size="sm"
                    onClick={() => setOpenStep(2)}
                    className="mt-2"
                    disabled={!isStep1Complete}
                  >
                    {t('continue')} <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </Card>

            {/* ─── STEP 2: Conditions ─── */}
            <Card className="overflow-hidden">
              <StepHeader
                number={2}
                title={t('setConditions')}
                subtitle={
                  isStep2Complete
                    ? config.conditions
                        .map((c) => {
                          const labelKey = METRIC_OPTIONS.find(
                            (m) => m.value === c.metric
                          )?.labelKey;

                          return `${labelKey ? tCommon(labelKey) : c.metric} ${c.operator} ${c.threshold}`;
                        })
                        .join(' AND ')
                    : t('setPerformanceThresholds')
                }
                isOpen={openStep === 2}
                onToggle={() => setOpenStep(openStep === 2 ? 0 : 2)}
                isComplete={isStep2Complete}
              />
              {openStep === 2 && (
                <div className="space-y-3 border-t border-[var(--color-border)] px-5 pt-4 pb-5">
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
                      <div className="grid flex-1 grid-cols-[1fr_auto_auto] gap-2">
                        <Select
                          value={cond.metric}
                          onChange={(value) => updateCondition(cond.id, { metric: value })}
                          options={METRIC_OPTIONS.map((o) => ({
                            label: tCommon(o.labelKey),
                            value: o.value,
                          }))}
                        />
                        <Select
                          value={cond.operator}
                          onChange={(value) => updateCondition(cond.id, { operator: value })}
                          options={OPERATOR_OPTIONS.map((o) => ({
                            label: t(o.labelKey),
                            value: o.value,
                          }))}
                          className="w-[180px]"
                        />
                        <Input
                          type="number"
                          value={cond.threshold}
                          onChange={(e) =>
                            updateCondition(cond.id, {
                              threshold: e.target.value,
                            })
                          }
                          placeholder={t('value')}
                          className="h-9 w-24"
                        />
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

                  <Button
                    size="sm"
                    onClick={() => setOpenStep(3)}
                    className="mt-2"
                    disabled={!isStep2Complete}
                  >
                    {t('continue')} <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </Card>

            {/* ─── STEP 3: Action ─── */}
            <Card className="overflow-hidden">
              <StepHeader
                number={3}
                title={t('actionStep')}
                subtitle={
                  isStep3Complete
                    ? `${config.action_type === 'promote' ? t('promotePauseDuplicate') : config.action_type === 'pause' ? t('pause') : config.action_type === 'activate' ? t('activate') : t('notify')}${config.also_notify_slack ? ` → ${config.slack_channel || 'Slack'}` : ''}`
                    : t('whatHappensWhenMet')
                }
                isOpen={openStep === 3}
                onToggle={() => setOpenStep(openStep === 3 ? 0 : 3)}
                isComplete={isStep3Complete}
              />
              {openStep === 3 && (
                <div className="space-y-4 border-t border-[var(--color-border)] px-5 pt-4 pb-5">
                  {/* Action type */}
                  <div>
                    <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                      {t('actionType')}
                    </label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
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
                      ].map((action) => (
                        <button
                          key={action.value}
                          onClick={() => updateConfig({ action_type: action.value })}
                          className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                            config.action_type === action.value
                              ? 'border-[var(--color-foreground)] bg-[var(--color-foreground)] text-[var(--color-background)]'
                              : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:border-[var(--color-border)]'
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

                  {/* Promote target */}
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
                            updateConfig({
                              target_adset_id: id,
                              target_adset_name: name,
                            })
                          }
                          placeholder={t('searchForWinnersAdSet')}
                        />
                      </div>
                    </div>
                  )}

                  {/* Slack notification */}
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
                            onChange={(e) =>
                              updateConfig({
                                slack_channel: e.target.value,
                              })
                            }
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
                            onChange={(e) =>
                              updateConfig({
                                slack_message: e.target.value,
                              })
                            }
                            className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 font-mono text-sm text-[var(--color-foreground)] focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            rows={3}
                            placeholder={t('leaveEmptyDefault')}
                          />
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {[
                              {
                                var: '{rule_name}',
                                label: t('ruleName'),
                              },
                              { var: '{action}', label: t('action') },
                              {
                                var: '{entity_name}',
                                label: tMetrics('adName'),
                              },
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
                                className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100"
                              >
                                <Plus className="h-2.5 w-2.5" />
                                {v.label}
                              </button>
                            ))}
                          </div>

                          {/* Live preview with matched ad data */}
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
                                    .replace(/\{ctr\}/g, `${sampleAd?.ctr || '0.00'}%`);
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
            </Card>

            {/* ─── Summary + Actions ─── */}
            {isStep1Complete && isStep2Complete && isStep3Complete && (
              <Card className="p-5">
                <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">
                  {t('summary')}
                </h3>
                <div className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
                  <p>
                    <span className="text-[var(--color-muted-foreground)]">{t('applyTo')}</span>{' '}
                    {config.entity_type === 'ad'
                      ? t('allAds')
                      : config.entity_type === 'adset'
                        ? t('allAdSets')
                        : tCommon('campaigns')}
                    {config.campaign_name && ' ' + t('inCampaign', { name: config.campaign_name })}
                  </p>
                  <p>
                    <span className="text-[var(--color-muted-foreground)]">{t('when')}</span>{' '}
                    {config.conditions.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && (
                          <span className="text-[var(--color-muted-foreground)]"> AND </span>
                        )}
                        <span className="font-medium text-[var(--color-foreground)]">
                          {(() => {
                            const lk = METRIC_OPTIONS.find((m) => m.value === c.metric)?.labelKey;

                            return lk ? tCommon(lk) : c.metric;
                          })()}{' '}
                          {c.operator} {c.threshold}
                        </span>
                      </span>
                    ))}
                  </p>
                  <p>
                    <span className="text-[var(--color-muted-foreground)]">{t('then')}</span>{' '}
                    <span className="font-medium text-[var(--color-foreground)] capitalize">
                      {config.action_type}
                    </span>
                    {config.action_type === 'promote' && config.target_adset_name && (
                      <span> {t('toAdSet', { name: config.target_adset_name })}</span>
                    )}
                    {config.also_notify_slack && config.slack_channel && (
                      <span> {t('notifyChannel', { channel: config.slack_channel })}</span>
                    )}
                  </p>
                  <p>
                    <span className="text-[var(--color-muted-foreground)]">{t('frequency')}</span>{' '}
                    {t(SCHEDULE_LABEL_KEYS[config.schedule] || 'scheduleLabels.hourly')} ·{' '}
                    {t(
                      DATE_PRESET_OPTIONS.find((d) => d.value === config.date_preset)?.labelKey ||
                        'datePresets.last7d'
                    )}
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-border)] pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestWorkflow}
                    disabled={testing}
                  >
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    {testing ? t('testing') : t('testRule')}
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saveRule.isPending}>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    {saveRule.isPending ? t('saving') : t('saveRule')}
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

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
