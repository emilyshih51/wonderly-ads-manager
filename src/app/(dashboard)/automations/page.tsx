'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Plus, Save, Trash2, Zap, Play, Pause,
  ArrowLeft, Search, X, ChevronDown, ChevronUp,
  Eye, ToggleLeft, ToggleRight, Loader2,
  Settings2, Check, AlertCircle, Target, Filter,
  Activity, Bell, Copy, ArrowRight,
} from 'lucide-react';

/* ─────────── Types ─────────── */

interface Condition {
  id: string;
  metric: string;
  operator: string;
  threshold: string;
}

interface RuleConfig {
  // Trigger
  entity_type: string;
  campaign_id: string;
  campaign_name: string;
  adset_filter: string; // 'all' | specific adset id
  adset_name: string;
  schedule: string;
  date_preset: string;
  // Conditions
  conditions: Condition[];
  // Action
  action_type: string;
  target_adset_id: string;
  target_adset_name: string;
  also_notify_slack: boolean;
  slack_channel: string;
  slack_message: string;
}

interface Rule {
  id: string;
  name: string;
  is_active: boolean;
  nodes: any[];
  edges: any[];
  config?: RuleConfig;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective: string;
}

interface AdSet {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  campaign_name?: string;
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

const METRIC_OPTIONS = [
  { label: 'Spend ($)', value: 'spend' },
  { label: 'Results', value: 'results' },
  { label: 'Cost per Result (CPA)', value: 'cost_per_result' },
  { label: 'Impressions', value: 'impressions' },
  { label: 'Clicks', value: 'clicks' },
  { label: 'CTR (%)', value: 'ctr' },
  { label: 'CPC ($)', value: 'cpc' },
  { label: 'CPM ($)', value: 'cpm' },
  { label: 'Frequency', value: 'frequency' },
];

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
  '15min': 'Every 15 min', 'hourly': 'Every hour', '6hours': 'Every 6 hours', 'daily': 'Daily',
};

const DEFAULT_CONFIG: RuleConfig = {
  entity_type: 'ad',
  campaign_id: '',
  campaign_name: '',
  adset_filter: 'all',
  adset_name: '',
  schedule: 'hourly',
  date_preset: 'today',
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
      slack_channel: '#emily-space',
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
      slack_channel: '#emily-space',
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
      slack_channel: '#emily-space',
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
      slack_channel: '#emily-space',
    },
  },
];

/* ─────────── Helper: convert config to nodes/edges for storage ─────────── */

function configToNodes(config: RuleConfig) {
  const nodes: any[] = [
    {
      id: 't1', type: 'trigger', position: { x: 300, y: 50 },
      data: {
        label: 'Scan Ads in Campaign',
        config: {
          entity_type: config.entity_type,
          schedule: config.schedule,
          campaign_id: config.campaign_id,
          campaign_name: config.campaign_name,
          adset_filter: config.adset_filter,
          adset_name: config.adset_name,
          date_preset: config.date_preset,
        },
      },
    },
  ];

  config.conditions.forEach((cond, i) => {
    nodes.push({
      id: cond.id || `c${i + 1}`, type: 'condition',
      position: { x: 300, y: 200 + i * 150 },
      data: {
        label: `${METRIC_OPTIONS.find(m => m.value === cond.metric)?.label || cond.metric} ${cond.operator} ${cond.threshold}`,
        config: { metric: cond.metric, operator: cond.operator, threshold: cond.threshold },
      },
    });
  });

  nodes.push({
    id: 'a1', type: 'action',
    position: { x: 300, y: 200 + config.conditions.length * 150 },
    data: {
      label: config.action_type === 'promote' ? 'Promote to Winners' : config.action_type === 'pause' ? 'Pause Ad' : 'Activate Ad',
      config: {
        action_type: config.action_type,
        target_adset_id: config.target_adset_id,
        target_adset_name: config.target_adset_name,
        also_notify_slack: String(config.also_notify_slack),
        slack_channel: config.slack_channel,
        slack_message: config.slack_message,
      },
    },
  });

  const edges: any[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ id: `e${i + 1}`, source: nodes[i].id, target: nodes[i + 1].id, animated: true });
  }

  return { nodes, edges };
}

function nodesToConfig(nodes: any[]): RuleConfig {
  const trigger = nodes.find((n: any) => n.type === 'trigger');
  const condNodes = nodes.filter((n: any) => n.type === 'condition');
  const action = nodes.find((n: any) => n.type === 'action');
  const tc = trigger?.data?.config || {};
  const ac = action?.data?.config || {};

  return {
    entity_type: tc.entity_type || 'ad',
    campaign_id: tc.campaign_id || '',
    campaign_name: tc.campaign_name || '',
    adset_filter: tc.adset_filter || 'all',
    adset_name: tc.adset_name || '',
    schedule: tc.schedule || 'hourly',
    date_preset: tc.date_preset || 'today',
    conditions: condNodes.map((n: any, i: number) => ({
      id: n.id || `c${i + 1}`,
      metric: n.data?.config?.metric || 'spend',
      operator: n.data?.config?.operator || '>=',
      threshold: n.data?.config?.threshold || '',
    })),
    action_type: ac.action_type || 'pause',
    target_adset_id: ac.target_adset_id || '',
    target_adset_name: ac.target_adset_name || '',
    also_notify_slack: ac.also_notify_slack === 'true' || ac.also_notify_slack === true,
    slack_channel: ac.slack_channel || '',
    slack_message: ac.slack_message || '',
  };
}

/* ─────────── Campaign Search Component ─────────── */

function CampaignSearch({
  value,
  displayName,
  onChange,
  placeholder,
}: {
  value: string;
  displayName: string;
  onChange: (id: string, name: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const searchCampaigns = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/automations/search?type=campaigns&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.data || []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchCampaigns(val), 300);
  };

  const handleFocus = () => {
    setOpen(true);
    if (results.length === 0) searchCampaigns(query);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={open ? query : displayName || query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder || 'Search campaigns...'}
          className="w-full h-10 pl-9 pr-8 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {value && (
          <button
            onClick={() => { onChange('', ''); setQuery(''); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100"
          >
            <X className="h-3.5 w-3.5 text-gray-400" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500">No campaigns found</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  onChange(c.id, c.name);
                  setQuery(c.name);
                  setOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between border-b border-gray-50 last:border-0 ${
                  c.id === value ? 'bg-blue-50' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">{c.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{c.objective} · {c.status}</p>
                </div>
                {c.id === value && <Check className="h-4 w-4 text-blue-600 flex-shrink-0 ml-2" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────── AdSet Search Component ─────────── */

function AdSetSearch({
  value,
  displayName,
  campaignId,
  onChange,
  placeholder,
}: {
  value: string;
  displayName: string;
  campaignId?: string;
  onChange: (id: string, name: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdSet[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const searchAdSets = useCallback(async (q: string) => {
    setLoading(true);
    try {
      let url = `/api/automations/search?type=adsets&q=${encodeURIComponent(q)}`;
      if (campaignId) url += `&campaign_id=${campaignId}`;
      const res = await fetch(url);
      const data = await res.json();
      setResults(data.data || []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, [campaignId]);

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchAdSets(val), 300);
  };

  const handleFocus = () => {
    setOpen(true);
    if (results.length === 0) searchAdSets(query);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={open ? query : displayName || query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder || 'Search ad sets...'}
          className="w-full h-10 pl-9 pr-8 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {value && (
          <button
            onClick={() => { onChange('', ''); setQuery(''); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100"
          >
            <X className="h-3.5 w-3.5 text-gray-400" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500">No ad sets found</div>
          ) : (
            results.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  onChange(a.id, a.name);
                  setQuery(a.name);
                  setOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between border-b border-gray-50 last:border-0 ${
                  a.id === value ? 'bg-blue-50' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">{a.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{a.status}{a.campaign_name ? ` · ${a.campaign_name}` : ''}</p>
                </div>
                {a.id === value && <Check className="h-4 w-4 text-blue-600 flex-shrink-0 ml-2" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

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
      className="w-full flex items-center gap-4 p-5 text-left hover:bg-gray-50 transition-colors"
    >
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold flex-shrink-0 ${
        isComplete
          ? 'bg-emerald-100 text-emerald-700'
          : 'bg-gray-100 text-gray-500'
      }`}>
        {isComplete ? <Check className="h-4 w-4" /> : number}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {isOpen ? (
        <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" />
      ) : (
        <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
      )}
    </button>
  );
}

/* ─────────── Main Component ─────────── */

export default function AutomationsPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list');
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [config, setConfig] = useState<RuleConfig>({ ...DEFAULT_CONFIG });
  const [saving, setSaving] = useState(false);

  // Step accordion
  const [openStep, setOpenStep] = useState<number>(1);

  // Preview state
  const [previewAds, setPreviewAds] = useState<PreviewAd[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  // Test state
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);

  // Activity log
  const [activityLog, setActivityLog] = useState<any[]>([]);

  /* ─── API ─── */
  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/automations/rules');
      const data = await res.json();
      setRules(data.data || []);
    } catch (err) { console.error('Failed to fetch rules:', err); }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/automations/history');
      const data = await res.json();
      setActivityLog(data.data || []);
    } catch (err) { console.error('Failed to fetch history:', err); }
  }, []);

  useEffect(() => { fetchRules(); fetchHistory(); }, [fetchRules, fetchHistory]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { nodes, edges } = configToNodes(config);
      const method = selectedRule ? 'PUT' : 'POST';
      const body = {
        ...(selectedRule && { id: selectedRule.id }),
        name: ruleName,
        is_active: selectedRule?.is_active ?? false,
        nodes,
        edges,
      };
      await fetch('/api/automations/rules', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await fetchRules();
      setViewMode('list');
    } catch (err) { console.error('Save failed:', err); }
    finally { setSaving(false); }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      await fetch(`/api/automations/rules?id=${ruleId}`, { method: 'DELETE' });
      fetchRules();
      if (selectedRule?.id === ruleId) setSelectedRule(null);
    } catch (err) { console.error('Delete failed:', err); }
  };

  const handleToggle = async (rule: Rule) => {
    try {
      await fetch('/api/automations/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rule.id, is_active: !rule.is_active }),
      });
      fetchRules();
    } catch (err) { console.error('Toggle failed:', err); }
  };

  const useTemplate = (template: Template) => {
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

  /* ─── Preview Matching Ads ─── */
  const loadPreview = async () => {
    setPreviewLoading(true);
    try {
      const condParam = config.conditions
        .filter(c => c.threshold)
        .map(c => ({ metric: c.metric, operator: c.operator, threshold: c.threshold }));

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
      console.error('Preview failed:', err);
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
      await fetch('/api/automations/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_name: ruleName,
          type: 'test',
          matched: data.matched || 0,
          results: data.results || [],
        }),
      });
      fetchHistory();
    } catch (err) {
      setTestResults({ error: String(err) });
      setTestDialogOpen(true);
    } finally { setTesting(false); }
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
      conditions: config.conditions.map((c) => c.id === id ? { ...c, ...updates } : c),
    });
  };

  const removeCondition = (id: string) => {
    if (config.conditions.length <= 1) return;
    updateConfig({ conditions: config.conditions.filter((c) => c.id !== id) });
  };

  /* ─── Step completeness checks ─── */
  const isStep1Complete = !!config.campaign_id;
  const isStep2Complete = config.conditions.length > 0 && config.conditions.every(c => c.threshold !== '');
  const isStep3Complete = !!config.action_type && (config.action_type !== 'promote' || !!config.target_adset_id);

  /* ─── Rule summary for list ─── */
  const getRuleSummary = (rule: Rule) => {
    const cfg = nodesToConfig(rule.nodes);
    return cfg;
  };

  /* ─────────── RENDER ─────────── */
  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-5">
        <div className="flex items-center gap-3">
          {viewMode === 'editor' && (
            <Button variant="ghost" size="icon" onClick={() => setViewMode('list')} className="h-8 w-8 mr-1">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {viewMode === 'list' ? 'Automations' : (selectedRule ? 'Edit Rule' : 'New Rule')}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {viewMode === 'list'
                ? 'Rules that automatically manage your ads'
                : 'Configure your automation step by step'
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'editor' && (
            <>
              <Button variant="outline" size="sm" onClick={handleTestWorkflow} disabled={testing}>
                <Play className="h-3.5 w-3.5 mr-1.5" />
                {testing ? 'Testing...' : 'Test Rule'}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {saving ? 'Saving...' : 'Save Rule'}
              </Button>
            </>
          )}
          {viewMode === 'list' && (
            <Button size="sm" onClick={newBlank}>
              <Plus className="h-4 w-4 mr-1" /> New Rule
            </Button>
          )}
        </div>
      </div>

      {/* ─── LIST VIEW ─── */}
      {viewMode === 'list' && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 py-8 space-y-10">

            {/* Templates */}
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Templates</h2>
              <div className="grid grid-cols-1 gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => useTemplate(t)}
                    className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-sm transition-all text-left group"
                  >
                    <span className="text-xl">{t.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                    </div>
                    <span className="text-xs text-blue-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                      Use <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Active Rules */}
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
                Your Rules {rules.length > 0 && `(${rules.length})`}
              </h2>
              {rules.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <Zap className="h-8 w-8 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">No rules yet</p>
                  <p className="text-xs text-gray-400 mt-1">Pick a template or create a new rule</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule) => {
                    const cfg = getRuleSummary(rule);
                    const condSummary = cfg.conditions
                      .map(c => `${METRIC_OPTIONS.find(m => m.value === c.metric)?.label || c.metric} ${c.operator} ${c.threshold}`)
                      .join(' AND ');
                    return (
                      <div
                        key={rule.id}
                        className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl"
                      >
                        <button onClick={() => handleToggle(rule)} className="flex-shrink-0" title={rule.is_active ? 'Pause rule' : 'Enable rule'}>
                          {rule.is_active ? (
                            <ToggleRight className="h-7 w-7 text-emerald-500" />
                          ) : (
                            <ToggleLeft className="h-7 w-7 text-gray-300" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium ${rule.is_active ? 'text-gray-900' : 'text-gray-400'}`}>
                              {rule.name}
                            </p>
                            <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              rule.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'
                            }`}>
                              {rule.is_active ? 'Active' : 'Off'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-400 flex-wrap">
                            {cfg.campaign_name && <span className="truncate max-w-[200px]">{cfg.campaign_name}</span>}
                            {cfg.campaign_name && <span>·</span>}
                            <span>{SCHEDULE_LABELS[cfg.schedule] || 'Hourly'}</span>
                            <span>·</span>
                            <span className="capitalize">{cfg.action_type}</span>
                            {cfg.slack_channel && <><span>·</span><span>{cfg.slack_channel}</span></>}
                          </div>
                          {condSummary && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate">If: {condSummary}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => editRule(rule)}>
                            <Settings2 className="h-3.5 w-3.5 text-gray-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(rule.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-400" />
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
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
                Activity Log {activityLog.length > 0 && `(${activityLog.length})`}
              </h2>
              {activityLog.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <Activity className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No runs yet</p>
                  <p className="text-xs text-gray-400 mt-1">Test or activate a rule to see results here</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activityLog.map((event) => {
                    const date = new Date(event.timestamp);
                    const timeStr = date.toLocaleString('en-US', {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
                    });
                    const isTest = event.type === 'test';
                    return (
                      <div key={event.id} className="bg-white border border-gray-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              isTest ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                            }`}>
                              {isTest ? 'Test' : 'Live'}
                            </span>
                            <p className="text-sm font-medium text-gray-900">{event.rule_name}</p>
                          </div>
                          <p className="text-xs text-gray-400">{timeStr}</p>
                        </div>
                        <div className="mt-2 text-xs text-gray-500">
                          {event.matched === 0 ? (
                            <p>No ads matched the conditions</p>
                          ) : (
                            <div className="space-y-1.5">
                              <p><span className="font-medium text-gray-700">{event.matched}</span> ad{event.matched !== 1 ? 's' : ''} matched</p>
                              {event.results?.map((r: any, i: number) => (
                                <div key={i} className="flex items-center justify-between pl-3 border-l-2 border-gray-100">
                                  <span className="truncate text-gray-700">{r.entity_name}</span>
                                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                    <span className="text-gray-400">
                                      ${r.metrics?.spend?.toFixed?.(2) || r.metrics?.spend || '0'} · {r.metrics?.results ?? 0} results
                                    </span>
                                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                      r.action?.includes('pause') || r.action?.includes('would_pause') ? 'bg-red-50 text-red-600' :
                                      r.action?.includes('promote') || r.action?.includes('would_promote') ? 'bg-emerald-50 text-emerald-600' :
                                      'bg-blue-50 text-blue-600'
                                    }`}>
                                      {r.action?.replace('would_', '')}
                                    </span>
                                    {r.slack_sent && <span className="text-emerald-500 text-[10px]">Slack sent</span>}
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
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <div className="max-w-2xl mx-auto px-8 py-6 space-y-4">

            {/* Rule Name */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Rule Name</label>
              <Input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                className="mt-2 h-10 text-base font-medium"
                placeholder="e.g., Pause ad: spend ≥ $30, 0 results"
              />
            </div>

            {/* ─── STEP 1: Apply rule to ─── */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <StepHeader
                number={1}
                title="Apply rule to"
                subtitle={config.campaign_name
                  ? `${config.entity_type === 'ad' ? 'All ads' : config.entity_type === 'adset' ? 'All ad sets' : 'Campaign'} in "${config.campaign_name}"`
                  : 'Select a campaign and entity type'
                }
                isOpen={openStep === 1}
                onToggle={() => setOpenStep(openStep === 1 ? 0 : 1)}
                isComplete={isStep1Complete}
              />
              {openStep === 1 && (
                <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
                  {/* Entity type */}
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Entity Level</label>
                    <div className="flex gap-2 mt-2">
                      {['ad', 'adset', 'campaign'].map((type) => (
                        <button
                          key={type}
                          onClick={() => updateConfig({ entity_type: type })}
                          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            config.entity_type === type
                              ? 'bg-gray-900 text-white border-gray-900'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          {type === 'ad' ? 'Ads' : type === 'adset' ? 'Ad Sets' : 'Campaigns'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Campaign selector */}
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</label>
                    <div className="mt-2">
                      <CampaignSearch
                        value={config.campaign_id}
                        displayName={config.campaign_name}
                        onChange={(id, name) => updateConfig({ campaign_id: id, campaign_name: name })}
                        placeholder="Search by campaign name..."
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">Leave empty to apply to all campaigns</p>
                  </div>

                  {/* Schedule */}
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Check Frequency</label>
                    <SelectNative
                      value={config.schedule}
                      onChange={(e) => updateConfig({ schedule: e.target.value })}
                      options={SCHEDULE_OPTIONS}
                      className="mt-2"
                    />
                  </div>

                  {/* Performance period */}
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Performance Period</label>
                    <SelectNative
                      value={config.date_preset}
                      onChange={(e) => updateConfig({ date_preset: e.target.value })}
                      options={DATE_PRESET_OPTIONS}
                      className="mt-2"
                    />
                    <p className="text-xs text-gray-400 mt-1.5">Time range used when evaluating conditions</p>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => setOpenStep(2)}
                    className="mt-2"
                    disabled={!isStep1Complete}
                  >
                    Continue <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* ─── STEP 2: Conditions ─── */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <StepHeader
                number={2}
                title="Conditions"
                subtitle={isStep2Complete
                  ? config.conditions.map(c =>
                      `${METRIC_OPTIONS.find(m => m.value === c.metric)?.label || c.metric} ${c.operator} ${c.threshold}`
                    ).join(' AND ')
                  : 'Set performance thresholds'
                }
                isOpen={openStep === 2}
                onToggle={() => setOpenStep(openStep === 2 ? 0 : 2)}
                isComplete={isStep2Complete}
              />
              {openStep === 2 && (
                <div className="px-5 pb-5 space-y-3 border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-500">All conditions must be met (AND logic)</p>

                  {config.conditions.map((cond, i) => (
                    <div key={cond.id} className="flex items-start gap-2">
                      {i > 0 && (
                        <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-1 rounded mt-2">AND</span>
                      )}
                      <div className="flex-1 grid grid-cols-[1fr_auto_auto] gap-2">
                        <SelectNative
                          value={cond.metric}
                          onChange={(e) => updateCondition(cond.id, { metric: e.target.value })}
                          options={METRIC_OPTIONS}
                        />
                        <SelectNative
                          value={cond.operator}
                          onChange={(e) => updateCondition(cond.id, { operator: e.target.value })}
                          options={OPERATOR_OPTIONS}
                          className="w-[180px]"
                        />
                        <Input
                          type="number"
                          value={cond.threshold}
                          onChange={(e) => updateCondition(cond.id, { threshold: e.target.value })}
                          placeholder="Value"
                          className="w-24 h-9"
                        />
                      </div>
                      <button
                        onClick={() => removeCondition(cond.id)}
                        className={`mt-2 p-1 rounded hover:bg-gray-100 ${config.conditions.length <= 1 ? 'opacity-30 cursor-not-allowed' : ''}`}
                        disabled={config.conditions.length <= 1}
                      >
                        <X className="h-4 w-4 text-gray-400" />
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={addCondition}
                    className="flex items-center gap-1.5 text-sm text-blue-600 font-medium hover:text-blue-700 mt-1"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add condition
                  </button>

                  {/* Preview Matching Ads */}
                  <div className="border-t border-gray-100 pt-4 mt-4">
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={loadPreview}
                        disabled={previewLoading || !isStep2Complete}
                      >
                        {previewLoading ? (
                          <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Loading...</>
                        ) : (
                          <><Eye className="h-3.5 w-3.5 mr-1.5" /> Preview Matching Ads</>
                        )}
                      </Button>
                      {previewLoaded && (
                        <span className="text-sm text-gray-600">
                          <span className="font-semibold text-gray-900">{previewAds.length}</span> of {previewTotal} ads match
                        </span>
                      )}
                    </div>

                    {previewLoaded && previewAds.length > 0 && (
                      <div className="mt-3 rounded-lg border border-gray-200 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-3 py-2 font-medium text-gray-500">Ad Name</th>
                              <th className="text-right px-3 py-2 font-medium text-gray-500">Spend</th>
                              <th className="text-right px-3 py-2 font-medium text-gray-500">Results</th>
                              <th className="text-right px-3 py-2 font-medium text-gray-500">CPA</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {previewAds.slice(0, 10).map((ad) => (
                              <tr key={ad.ad_id} className="hover:bg-gray-50">
                                <td className="px-3 py-2 text-gray-900 truncate max-w-[200px]">{ad.ad_name}</td>
                                <td className="px-3 py-2 text-right text-gray-600">${ad.spend}</td>
                                <td className="px-3 py-2 text-right text-gray-600">{ad.results}</td>
                                <td className="px-3 py-2 text-right text-gray-600">{ad.cpa === 'N/A' ? '—' : `$${ad.cpa}`}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {previewAds.length > 10 && (
                          <div className="px-3 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
                            + {previewAds.length - 10} more ads
                          </div>
                        )}
                      </div>
                    )}

                    {previewLoaded && previewAds.length === 0 && (
                      <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-4 text-center">
                        <p className="text-sm text-gray-500">No ads currently match these conditions</p>
                        <p className="text-xs text-gray-400 mt-1">Check your campaign selection and thresholds</p>
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    onClick={() => setOpenStep(3)}
                    className="mt-2"
                    disabled={!isStep2Complete}
                  >
                    Continue <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* ─── STEP 3: Action ─── */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <StepHeader
                number={3}
                title="Action"
                subtitle={isStep3Complete
                  ? `${config.action_type === 'promote' ? 'Promote (pause + duplicate)' : config.action_type === 'pause' ? 'Pause' : config.action_type === 'activate' ? 'Activate' : 'Notify'}${config.also_notify_slack ? ` → ${config.slack_channel || 'Slack'}` : ''}`
                  : 'What happens when conditions are met'
                }
                isOpen={openStep === 3}
                onToggle={() => setOpenStep(openStep === 3 ? 0 : 3)}
                isComplete={isStep3Complete}
              />
              {openStep === 3 && (
                <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
                  {/* Action type */}
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Action Type</label>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {[
                        { value: 'pause', label: 'Pause', icon: <Pause className="h-4 w-4" />, desc: 'Turn off the ad' },
                        { value: 'promote', label: 'Promote', icon: <Copy className="h-4 w-4" />, desc: 'Pause + duplicate to winners' },
                        { value: 'activate', label: 'Activate', icon: <Play className="h-4 w-4" />, desc: 'Turn on the ad' },
                        { value: 'slack_notify', label: 'Notify Only', icon: <Bell className="h-4 w-4" />, desc: 'Just send a Slack message' },
                      ].map((action) => (
                        <button
                          key={action.value}
                          onClick={() => updateConfig({ action_type: action.value })}
                          className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                            config.action_type === action.value
                              ? 'bg-gray-900 text-white border-gray-900'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          {action.icon}
                          <div>
                            <p className="text-sm font-medium">{action.label}</p>
                            <p className={`text-[10px] ${config.action_type === action.value ? 'text-gray-300' : 'text-gray-400'}`}>
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
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Target Ad Set <span className="normal-case text-gray-400 font-normal">(duplicate winning ads here)</span>
                      </label>
                      <div className="mt-2">
                        <AdSetSearch
                          value={config.target_adset_id}
                          displayName={config.target_adset_name}
                          onChange={(id, name) => updateConfig({ target_adset_id: id, target_adset_name: name })}
                          placeholder="Search for winners ad set..."
                        />
                      </div>
                    </div>
                  )}

                  {/* Slack notification */}
                  <div className="border-t border-gray-100 pt-4">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.also_notify_slack}
                        onChange={(e) => updateConfig({ also_notify_slack: e.target.checked })}
                        className="rounded border-gray-300 text-blue-600 h-4 w-4"
                      />
                      <span className="text-sm font-medium text-gray-700">Send Slack notification</span>
                    </label>

                    {config.also_notify_slack && (
                      <div className="mt-3 space-y-3 ml-6">
                        <div>
                          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Channel</label>
                          <Input
                            value={config.slack_channel}
                            onChange={(e) => updateConfig({ slack_channel: e.target.value })}
                            className="mt-1 h-9"
                            placeholder="#emily-space"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Custom Message <span className="normal-case text-gray-400 font-normal">(optional)</span>
                          </label>
                          <textarea
                            value={config.slack_message}
                            onChange={(e) => updateConfig({ slack_message: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                            rows={3}
                            placeholder="Leave empty for default message"
                          />
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {[
                              { var: '{rule_name}', label: 'Rule Name' },
                              { var: '{action}', label: 'Action' },
                              { var: '{entity_name}', label: 'Ad Name' },
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
                                onClick={() => updateConfig({ slack_message: (config.slack_message || '') + v.var })}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[11px] font-medium hover:bg-blue-100 transition-colors"
                              >
                                <Plus className="h-2.5 w-2.5" />{v.label}
                              </button>
                            ))}
                          </div>

                          {/* Live preview with matched ad data */}
                          {(config.slack_message || previewAds.length > 0) && (
                            <div className="mt-3">
                              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">Message Preview</p>
                              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700 whitespace-pre-wrap">
                                {(() => {
                                  const sampleAd = previewAds[0];
                                  const actionVerb = config.action_type === 'promote' ? 'Promoted' : config.action_type === 'pause' ? 'Paused' : config.action_type === 'activate' ? 'Activated' : 'Notified';
                                  const msg = config.slack_message || `${config.action_type === 'promote' ? '🚀' : '⏸️'} *${ruleName}*\n${actionVerb} ad: ${sampleAd ? sampleAd.ad_name : '<ad name>'}\nSpend: $${sampleAd?.spend || '0.00'} · Results: ${sampleAd?.results ?? 0} · CPA: ${sampleAd?.cpa === 'N/A' ? 'N/A' : `$${sampleAd?.cpa || '0.00'}`}`;
                                  return msg
                                    .replace(/\{rule_name\}/g, ruleName || 'Rule Name')
                                    .replace(/\{action\}/g, actionVerb)
                                    .replace(/\{entity_name\}/g, sampleAd?.ad_name || '<ad name>')
                                    .replace(/\{ad_link\}/g, sampleAd?.ad_name || '<ad name>')
                                    .replace(/\{spend\}/g, `$${sampleAd?.spend || '0.00'}`)
                                    .replace(/\{results\}/g, String(sampleAd?.results ?? 0))
                                    .replace(/\{cpa\}/g, sampleAd?.cpa === 'N/A' ? 'N/A' : `$${sampleAd?.cpa || '0.00'}`)
                                    .replace(/\{clicks\}/g, String(sampleAd?.clicks ?? 0))
                                    .replace(/\{ctr\}/g, `${sampleAd?.ctr || '0.00'}%`);
                                })()}
                              </div>
                              {previewAds.length > 0 && (
                                <p className="text-[10px] text-gray-400 mt-1">
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
            {(isStep1Complete && isStep2Complete && isStep3Complete) && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Summary</h3>
                <div className="space-y-2 text-sm text-gray-600">
                  <p>
                    <span className="text-gray-400">Apply to:</span>{' '}
                    {config.entity_type === 'ad' ? 'All ads' : config.entity_type === 'adset' ? 'All ad sets' : 'Campaigns'}
                    {config.campaign_name && ` in "${config.campaign_name}"`}
                  </p>
                  <p>
                    <span className="text-gray-400">When:</span>{' '}
                    {config.conditions.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && <span className="text-gray-400"> AND </span>}
                        <span className="font-medium text-gray-800">
                          {METRIC_OPTIONS.find(m => m.value === c.metric)?.label} {c.operator} {c.threshold}
                        </span>
                      </span>
                    ))}
                  </p>
                  <p>
                    <span className="text-gray-400">Then:</span>{' '}
                    <span className="font-medium text-gray-800 capitalize">{config.action_type}</span>
                    {config.action_type === 'promote' && config.target_adset_name && (
                      <span> to "{config.target_adset_name}"</span>
                    )}
                    {config.also_notify_slack && config.slack_channel && (
                      <span> + notify {config.slack_channel}</span>
                    )}
                  </p>
                  <p>
                    <span className="text-gray-400">Frequency:</span>{' '}
                    {SCHEDULE_LABELS[config.schedule]} · {DATE_PRESET_OPTIONS.find(d => d.value === config.date_preset)?.label || config.date_preset}
                  </p>
                </div>
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                  <Button variant="outline" size="sm" onClick={handleTestWorkflow} disabled={testing}>
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    {testing ? 'Testing...' : 'Test Rule'}
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    {saving ? 'Saving...' : 'Save Rule'}
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
          <div className="mt-2 space-y-3 max-h-[400px] overflow-y-auto">
            {testResults?.error ? (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-sm text-red-700">{testResults.error}</p>
              </div>
            ) : testResults?.matched === 0 ? (
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-center">
                <p className="text-sm text-gray-600 font-medium">No ads matched the conditions</p>
                <p className="text-xs text-gray-400 mt-1">Either no ads meet the thresholds, or check the campaign filter.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">{testResults?.matched || 0}</span> ad{testResults?.matched !== 1 ? 's' : ''} would be affected:
                </p>
                {testResults?.results?.map((r: any, i: number) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900 truncate">{r.entity_name}</p>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                        r.action?.includes('pause') ? 'bg-red-50 text-red-600' :
                        r.action?.includes('promote') ? 'bg-emerald-50 text-emerald-600' :
                        'bg-blue-50 text-blue-600'
                      }`}>
                        {r.action?.replace('would_', '→ ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                      <span>Spend: ${r.metrics?.spend?.toFixed(2)}</span>
                      <span>Results: {r.metrics?.results}</span>
                      <span>CPA: {r.metrics?.cost_per_result === 'N/A' ? 'N/A' : `$${r.metrics?.cost_per_result}`}</span>
                    </div>
                    {r.warning && <p className="mt-1 text-[10px] text-amber-600">{r.warning}</p>}
                    {r.slack_sent && r.slack_channel && (
                      <p className="mt-1 text-[10px] text-emerald-600">Slack sent to {r.slack_channel}</p>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={() => setTestDialogOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
