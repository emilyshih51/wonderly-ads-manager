'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
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
  ToggleLeft,
  ToggleRight,
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
  { label: 'is greater than', value: '>' },
  { label: 'is less than', value: '<' },
  { label: 'is greater than or equal to', value: '>=' },
  { label: 'is less than or equal to', value: '<=' },
  { label: 'is equal to', value: '==' },
];

const DATE_PRESET_OPTIONS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 3 days', value: 'last_3d' },
  { label: 'Last 7 days', value: 'last_7d' },
  { label: 'Last 14 days', value: 'last_14d' },
  { label: 'Last 30 days', value: 'last_30d' },
];

const SCHEDULE_OPTIONS = [
  { label: 'Every 15 minutes', value: '15min' },
  { label: 'Every hour', value: 'hourly' },
  { label: 'Every 6 hours', value: '6hours' },
  { label: 'Daily', value: 'daily' },
];

const SCHEDULE_LABELS: Record<string, string> = {
  '15min': 'Every 15 min',
  hourly: 'Every hour',
  '6hours': 'Every 6 hours',
  daily: 'Daily',
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
  name: string;
  description: string;
  icon: string;
  category: 'protect' | 'optimize';
  config: RuleConfig;
}

const TEMPLATES: Template[] = [
  {
    id: 'pause-zero-results',
    name: 'Pause ad: spend ≥ $30, 0 results',
    description: 'Pause any ad spending $30+ with zero conversions',
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
    name: 'Pause ad: spend ≥ $30, CPA ≥ $25',
    description: 'Pause any ad spending $30+ with CPA at or above $25',
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
    name: 'Promote ad: CPA ≤ $15, results ≥ 3',
    description: 'Pause + duplicate to Winners ad set when CPA is low',
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
    name: 'Promote ad: CPA ≤ $20, results ≥ 5',
    description: 'Pause + duplicate to Winners ad set with more results',
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
    <div className="relative overflow-hidden rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
      {/* Background accent */}
      <div className="absolute top-0 right-0 -mt-20 -mr-20 h-40 w-40 rounded-full bg-gradient-to-bl from-blue-100 to-transparent opacity-30" />

      <div className="relative z-10">
        <div className="mb-4 flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-[var(--color-foreground)]">Copilot</h3>
          <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
            AI beta
          </span>
        </div>

        <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
          Describe what you want to automate in plain English
        </p>

        <div className="space-y-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pause ads with CPA over $25 in Brad campaign... or promote ads with CPA under $16 and results above 3"
            disabled={isSubmitting}
            className="h-24 w-full resize-none rounded-lg border border-blue-200 bg-[var(--color-card)] p-3 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />

          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={!input.trim() || isSubmitting}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Building...
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-3.5 w-3.5" />
                  Start building
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AutomationsPage() {
  const t = useTranslations('automations');
  const { data: rules = [] } = useRules();
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
    setRuleName(template.name);
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
    setRuleName('New Automation');
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
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-card)] px-8 py-5">
        <div className="flex items-center gap-3">
          {viewMode === 'editor' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setViewMode('list')}
              className="mr-1 h-8 w-8"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
              {viewMode === 'list' ? t('title') : selectedRule ? t('saveRule') : t('newRule')}
            </h1>
            <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">
              {viewMode === 'list' ? t('description') : t('conditions')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'editor' && (
            <>
              <Button variant="outline" size="sm" onClick={handleTestWorkflow} disabled={testing}>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                {testing ? 'Testing...' : 'Test Rule'}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saveRule.isPending}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saveRule.isPending ? 'Saving...' : 'Save Rule'}
              </Button>
            </>
          )}
          {viewMode === 'list' && (
            <Button size="sm" onClick={newBlank}>
              <Plus className="mr-1 h-4 w-4" /> New Rule
            </Button>
          )}
        </div>
      </div>

      {/* ─── LIST VIEW ─── */}
      {viewMode === 'list' && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-10 px-8 py-8">
            {/* Copilot */}
            <CopilotCard onSubmit={useCopilot} />

            {/* Templates */}
            <div>
              <h2 className="mb-4 text-xs font-semibold tracking-wider text-[var(--color-muted-foreground)] uppercase">
                Templates
              </h2>
              <div className="grid grid-cols-1 gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => applyTemplate(t)}
                    className="group flex items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left transition-all hover:border-[var(--color-border)] hover:shadow-sm"
                  >
                    <span className="text-xl">{t.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{t.name}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                        {t.description}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 text-xs font-medium text-blue-600 opacity-0 transition-opacity group-hover:opacity-100">
                      Use <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Active Rules */}
            <div>
              <h2 className="mb-4 text-xs font-semibold tracking-wider text-[var(--color-muted-foreground)] uppercase">
                Your Rules {rules.length > 0 && `(${rules.length})`}
              </h2>
              {rules.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-muted)] py-12 text-center">
                  <Zap className="mx-auto mb-3 h-8 w-8 text-[var(--color-muted-foreground)]" />
                  <p className="text-sm text-[var(--color-muted-foreground)]">No rules yet</p>
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    Pick a template or create a new rule
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule) => {
                    const cfg = getRuleSummary(rule);
                    const condSummary = cfg.conditions
                      .map(
                        (c) =>
                          `${METRIC_OPTIONS.find((m) => m.value === c.metric)?.label || c.metric} ${c.operator} ${c.threshold}`
                      )
                      .join(' AND ');

                    return (
                      <div
                        key={rule.id}
                        className="flex items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
                      >
                        <button
                          onClick={() => handleToggle(rule)}
                          className="flex-shrink-0"
                          title={rule.is_active ? 'Pause rule' : 'Enable rule'}
                        >
                          {rule.is_active ? (
                            <ToggleRight className="h-7 w-7 text-emerald-500" />
                          ) : (
                            <ToggleLeft className="h-7 w-7 text-[var(--color-muted-foreground)]" />
                          )}
                        </button>
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
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
                              }`}
                            >
                              {rule.is_active ? 'Active' : 'Off'}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                            {cfg.campaign_name && (
                              <span className="max-w-[200px] truncate">{cfg.campaign_name}</span>
                            )}
                            {cfg.campaign_name && <span>·</span>}
                            <span>{SCHEDULE_LABELS[cfg.schedule] || 'Hourly'}</span>
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
                              If: {condSummary}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setConfirmRunRule(rule)}
                            disabled={runningRuleId === rule.id}
                          >
                            {runningRuleId === rule.id ? (
                              <>
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Running...
                              </>
                            ) : (
                              <>
                                <Play className="mr-1 h-3 w-3" /> Run Now
                              </>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => editRule(rule)}
                          >
                            <Settings2 className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleDelete(rule.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-[var(--color-muted-foreground)] hover:text-red-400" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Activity Log */}
            <div>
              <h2 className="mb-4 text-xs font-semibold tracking-wider text-[var(--color-muted-foreground)] uppercase">
                Activity Log {activityLog.length > 0 && `(${activityLog.length})`}
              </h2>
              {activityLog.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-muted)] py-8 text-center">
                  <Activity className="mx-auto mb-2 h-8 w-8 text-[var(--color-muted-foreground)]" />
                  <p className="text-sm text-[var(--color-muted-foreground)]">No runs yet</p>
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    Test or activate a rule to see results here
                  </p>
                </div>
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
                      <div
                        key={event.id}
                        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                isTest
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              {isTest ? 'Test' : 'Live'}
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
                                  title="Undo actions from this run"
                                >
                                  {rollingBackId === event.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3 w-3" />
                                  )}
                                  Undo
                                </button>
                              )}
                            <p className="text-xs text-[var(--color-muted-foreground)]">
                              {timeStr}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                          {event.matched === 0 ? (
                            <p>No ads matched the conditions</p>
                          ) : (
                            <div className="space-y-1.5">
                              <p>
                                <span className="font-medium text-[var(--color-foreground)]">
                                  {event.matched}
                                </span>{' '}
                                ad{event.matched !== 1 ? 's' : ''} matched
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
                                      ${r.metrics?.spend?.toFixed?.(2) || r.metrics?.spend || '0'} ·{' '}
                                      {r.metrics?.results ?? 0} results
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
                                        Slack sent
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── EDITOR VIEW (Step-by-step form) ─── */}
      {viewMode === 'editor' && (
        <div className="flex-1 overflow-y-auto bg-[var(--color-background)]">
          <div className="mx-auto max-w-2xl space-y-4 px-8 py-6">
            {/* Rule Name */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
              <label className="text-xs font-semibold tracking-wider text-[var(--color-muted-foreground)] uppercase">
                Rule Name
              </label>
              <Input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                className="mt-2 h-10 text-base font-medium"
                placeholder="e.g., Pause ad: spend ≥ $30, 0 results"
              />
            </div>

            {/* ─── STEP 1: Apply rule to ─── */}
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
              <StepHeader
                number={1}
                title="Apply rule to"
                subtitle={
                  config.campaign_name
                    ? `${config.entity_type === 'ad' ? 'All ads' : config.entity_type === 'adset' ? 'All ad sets' : 'Campaign'} in "${config.campaign_name}"`
                    : 'Select a campaign and entity type'
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
                      Entity Level
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
                          {type === 'ad' ? 'Ads' : type === 'adset' ? 'Ad Sets' : 'Campaigns'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Campaign selector */}
                  <div>
                    <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                      Campaign
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
                        placeholder="Search by campaign name..."
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
                      Leave empty to apply to all campaigns
                    </p>
                  </div>

                  {/* Schedule */}
                  <div>
                    <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                      Check Frequency
                    </label>
                    <SelectNative
                      value={config.schedule}
                      onChange={(e) => updateConfig({ schedule: e.target.value })}
                      options={SCHEDULE_OPTIONS}
                      className="mt-2"
                    />
                  </div>

                  {/* Performance period */}
                  <div>
                    <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                      Performance Period
                    </label>
                    <SelectNative
                      value={config.date_preset}
                      onChange={(e) => updateConfig({ date_preset: e.target.value })}
                      options={DATE_PRESET_OPTIONS}
                      className="mt-2"
                    />
                    <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
                      Time range used when evaluating conditions
                    </p>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => setOpenStep(2)}
                    className="mt-2"
                    disabled={!isStep1Complete}
                  >
                    Continue <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* ─── STEP 2: Conditions ─── */}
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
              <StepHeader
                number={2}
                title="Conditions"
                subtitle={
                  isStep2Complete
                    ? config.conditions
                        .map(
                          (c) =>
                            `${METRIC_OPTIONS.find((m) => m.value === c.metric)?.label || c.metric} ${c.operator} ${c.threshold}`
                        )
                        .join(' AND ')
                    : 'Set performance thresholds'
                }
                isOpen={openStep === 2}
                onToggle={() => setOpenStep(openStep === 2 ? 0 : 2)}
                isComplete={isStep2Complete}
              />
              {openStep === 2 && (
                <div className="space-y-3 border-t border-[var(--color-border)] px-5 pt-4 pb-5">
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    All conditions must be met (AND logic)
                  </p>

                  {config.conditions.map((cond, i) => (
                    <div key={cond.id} className="flex items-start gap-2">
                      {i > 0 && (
                        <span className="mt-2 rounded bg-[var(--color-muted)] px-2 py-1 text-xs font-semibold text-[var(--color-muted-foreground)]">
                          AND
                        </span>
                      )}
                      <div className="grid flex-1 grid-cols-[1fr_auto_auto] gap-2">
                        <SelectNative
                          value={cond.metric}
                          onChange={(e) =>
                            updateCondition(cond.id, {
                              metric: e.target.value,
                            })
                          }
                          options={METRIC_OPTIONS}
                        />
                        <SelectNative
                          value={cond.operator}
                          onChange={(e) =>
                            updateCondition(cond.id, {
                              operator: e.target.value,
                            })
                          }
                          options={OPERATOR_OPTIONS}
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
                          placeholder="Value"
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
                    <Plus className="h-3.5 w-3.5" /> Add condition
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
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Loading...
                          </>
                        ) : (
                          <>
                            <Eye className="mr-1.5 h-3.5 w-3.5" /> Preview Matching Ads
                          </>
                        )}
                      </Button>
                      {previewLoaded && (
                        <span className="text-sm text-[var(--color-muted-foreground)]">
                          <span className="font-semibold text-[var(--color-foreground)]">
                            {previewAds.length}
                          </span>{' '}
                          of {previewTotal} ads match
                        </span>
                      )}
                    </div>

                    {previewLoaded && previewAds.length > 0 && (
                      <div className="mt-3 overflow-hidden rounded-lg border border-[var(--color-border)]">
                        <table className="w-full text-xs">
                          <thead className="bg-[var(--color-muted)]">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-[var(--color-muted-foreground)]">
                                Ad Name
                              </th>
                              <th className="px-3 py-2 text-right font-medium text-[var(--color-muted-foreground)]">
                                Spend
                              </th>
                              <th className="px-3 py-2 text-right font-medium text-[var(--color-muted-foreground)]">
                                Results
                              </th>
                              <th className="px-3 py-2 text-right font-medium text-[var(--color-muted-foreground)]">
                                CPA
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
                            + {previewAds.length - 10} more ads
                          </div>
                        )}
                      </div>
                    )}

                    {previewLoaded && previewAds.length === 0 && (
                      <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-4 text-center">
                        <p className="text-sm text-[var(--color-muted-foreground)]">
                          No ads currently match these conditions
                        </p>
                        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                          Check your campaign selection and thresholds
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
                    Continue <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* ─── STEP 3: Action ─── */}
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
              <StepHeader
                number={3}
                title="Action"
                subtitle={
                  isStep3Complete
                    ? `${config.action_type === 'promote' ? 'Promote (pause + duplicate)' : config.action_type === 'pause' ? 'Pause' : config.action_type === 'activate' ? 'Activate' : 'Notify'}${config.also_notify_slack ? ` → ${config.slack_channel || 'Slack'}` : ''}`
                    : 'What happens when conditions are met'
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
                      Action Type
                    </label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {[
                        {
                          value: 'pause',
                          label: 'Pause',
                          icon: <Pause className="h-4 w-4" />,
                          desc: 'Turn off the ad',
                        },
                        {
                          value: 'promote',
                          label: 'Promote',
                          icon: <Copy className="h-4 w-4" />,
                          desc: 'Pause + duplicate to winners',
                        },
                        {
                          value: 'activate',
                          label: 'Activate',
                          icon: <Play className="h-4 w-4" />,
                          desc: 'Turn on the ad',
                        },
                        {
                          value: 'slack_notify',
                          label: 'Notify Only',
                          icon: <Bell className="h-4 w-4" />,
                          desc: 'Just send a Slack message',
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
                        Target Ad Set{' '}
                        <span className="font-normal text-[var(--color-muted-foreground)] normal-case">
                          (duplicate winning ads here)
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
                          placeholder="Search for winners ad set..."
                        />
                      </div>
                    </div>
                  )}

                  {/* Slack notification */}
                  <div className="border-t border-[var(--color-border)] pt-4">
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={config.also_notify_slack}
                        onChange={(e) =>
                          updateConfig({
                            also_notify_slack: e.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-[var(--color-border)] text-blue-600"
                      />
                      <span className="text-sm font-medium text-[var(--color-foreground)]">
                        Send Slack notification
                      </span>
                    </label>

                    {config.also_notify_slack && (
                      <div className="mt-3 ml-6 space-y-3">
                        <div>
                          <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                            Channel
                          </label>
                          <Input
                            value={config.slack_channel}
                            onChange={(e) =>
                              updateConfig({
                                slack_channel: e.target.value,
                              })
                            }
                            className="mt-1 h-9"
                            placeholder="#alerts"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                            Custom Message{' '}
                            <span className="font-normal text-[var(--color-muted-foreground)] normal-case">
                              (optional)
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
                            placeholder="Leave empty for default message"
                          />
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {[
                              {
                                var: '{rule_name}',
                                label: 'Rule Name',
                              },
                              { var: '{action}', label: 'Action' },
                              {
                                var: '{entity_name}',
                                label: 'Ad Name',
                              },
                              { var: '{ad_link}', label: 'Ad Link' },
                              { var: '{spend}', label: 'Spend' },
                              { var: '{results}', label: 'Results' },
                              { var: '{cpa}', label: 'CPA' },
                              { var: '{clicks}', label: 'Clicks' },
                              { var: '{ctr}', label: 'CTR' },
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
                                Message Preview
                              </p>
                              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-sm whitespace-pre-wrap text-[var(--color-foreground)]">
                                {(() => {
                                  const sampleAd = previewAds[0];
                                  const actionVerb =
                                    config.action_type === 'promote'
                                      ? 'Promoted'
                                      : config.action_type === 'pause'
                                        ? 'Paused'
                                        : config.action_type === 'activate'
                                          ? 'Activated'
                                          : 'Notified';
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
                                  Previewing with: {previewAds[0].ad_name}
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

            {/* ─── Summary + Actions ─── */}
            {isStep1Complete && isStep2Complete && isStep3Complete && (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
                <h3 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">
                  Summary
                </h3>
                <div className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
                  <p>
                    <span className="text-[var(--color-muted-foreground)]">Apply to:</span>{' '}
                    {config.entity_type === 'ad'
                      ? 'All ads'
                      : config.entity_type === 'adset'
                        ? 'All ad sets'
                        : 'Campaigns'}
                    {config.campaign_name && ` in "${config.campaign_name}"`}
                  </p>
                  <p>
                    <span className="text-[var(--color-muted-foreground)]">When:</span>{' '}
                    {config.conditions.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && (
                          <span className="text-[var(--color-muted-foreground)]"> AND </span>
                        )}
                        <span className="font-medium text-[var(--color-foreground)]">
                          {METRIC_OPTIONS.find((m) => m.value === c.metric)?.label} {c.operator}{' '}
                          {c.threshold}
                        </span>
                      </span>
                    ))}
                  </p>
                  <p>
                    <span className="text-[var(--color-muted-foreground)]">Then:</span>{' '}
                    <span className="font-medium text-[var(--color-foreground)] capitalize">
                      {config.action_type}
                    </span>
                    {config.action_type === 'promote' && config.target_adset_name && (
                      <span> to &ldquo;{config.target_adset_name}&rdquo;</span>
                    )}
                    {config.also_notify_slack && config.slack_channel && (
                      <span> + notify {config.slack_channel}</span>
                    )}
                  </p>
                  <p>
                    <span className="text-[var(--color-muted-foreground)]">Frequency:</span>{' '}
                    {SCHEDULE_LABELS[config.schedule]} ·{' '}
                    {DATE_PRESET_OPTIONS.find((d) => d.value === config.date_preset)?.label ||
                      config.date_preset}
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
                    {testing ? 'Testing...' : 'Test Rule'}
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saveRule.isPending}>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    {saveRule.isPending ? 'Saving...' : 'Save Rule'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Test Results Dialog ─── */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Test Results</DialogTitle>
            <DialogDescription className="text-xs">
              Ads were not paused/promoted. Slack notifications were sent so you can preview them.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 max-h-[400px] space-y-3 overflow-y-auto">
            {testResults?.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-700">{testResults.error}</p>
              </div>
            ) : testResults?.matched === 0 ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-4 text-center">
                <p className="text-sm font-medium text-[var(--color-muted-foreground)]">
                  No ads matched the conditions
                </p>
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  Either no ads meet the thresholds, or check the campaign filter.
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  <span className="font-medium text-[var(--color-foreground)]">
                    {testResults?.matched || 0}
                  </span>{' '}
                  ad
                  {testResults?.matched !== 1 ? 's' : ''} would be affected:
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
                      <span>Spend: ${r.metrics?.spend?.toFixed(2)}</span>
                      <span>Results: {r.metrics?.results}</span>
                      <span>
                        CPA:{' '}
                        {r.metrics?.cost_per_result === 'N/A'
                          ? 'N/A'
                          : `$${r.metrics?.cost_per_result}`}
                      </span>
                    </div>
                    {r.warning && <p className="mt-1 text-[10px] text-amber-600">{r.warning}</p>}
                    {r.slack_sent && r.slack_channel && (
                      <p className="mt-1 text-[10px] text-emerald-600">
                        Slack sent to {r.slack_channel}
                      </p>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={() => setTestDialogOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Run Now Confirmation Dialog ─── */}
      <Dialog open={!!confirmRunRule} onOpenChange={(open) => !open && setConfirmRunRule(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Run Rule Now</DialogTitle>
            <DialogDescription className="text-xs">
              This will execute the rule for real — matching ads will be paused, promoted, or
              activated.
            </DialogDescription>
          </DialogHeader>
          {confirmRunRule && (
            <div className="mt-2 space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-800">{confirmRunRule.name}</p>
                <p className="mt-1 text-xs text-amber-700">
                  This will take real actions on your Meta ads. Are you sure?
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmRunRule(null)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => handleRunNow(confirmRunRule)}>
                  <Play className="mr-1.5 h-3.5 w-3.5" /> Run Now
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
            <DialogTitle className="text-base">Run Complete</DialogTitle>
            <DialogDescription className="text-xs">
              Actions have been executed on your Meta ads.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 max-h-[400px] space-y-3 overflow-y-auto">
            {runResults?.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-700">{runResults.error}</p>
              </div>
            ) : runResults?.matched === 0 ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-4 text-center">
                <p className="text-sm font-medium text-[var(--color-muted-foreground)]">
                  No ads matched the conditions
                </p>
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  No actions were taken.
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  <span className="font-medium text-[var(--color-foreground)]">
                    {runResults?.matched || 0}
                  </span>{' '}
                  ad
                  {runResults?.matched !== 1 ? 's' : ''} affected:
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
                      <span>Spend: ${r.metrics?.spend?.toFixed(2)}</span>
                      <span>Results: {r.metrics?.results}</span>
                      <span>
                        CPA:{' '}
                        {r.metrics?.cost_per_result === 'N/A'
                          ? 'N/A'
                          : `$${r.metrics?.cost_per_result}`}
                      </span>
                    </div>
                    {r.duplicated_ad_id && (
                      <p className="mt-1 text-[10px] text-emerald-600">
                        Duplicated to winners ad set
                      </p>
                    )}
                    {r.slack_sent && r.slack_channel && (
                      <p className="mt-1 text-[10px] text-emerald-600">
                        Slack sent to {r.slack_channel}
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
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
