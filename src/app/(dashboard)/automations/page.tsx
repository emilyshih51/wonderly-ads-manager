'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
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
  Search,
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
      id: 't1',
      type: 'trigger',
      position: { x: 300, y: 50 },
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
      id: cond.id || `c${i + 1}`,
      type: 'condition',
      position: { x: 300, y: 200 + i * 150 },
      data: {
        label: `${METRIC_OPTIONS.find((m) => m.value === cond.metric)?.label || cond.metric} ${cond.operator} ${cond.threshold}`,
        config: { metric: cond.metric, operator: cond.operator, threshold: cond.threshold },
      },
    });
  });

  nodes.push({
    id: 'a1',
    type: 'action',
    position: { x: 300, y: 200 + config.conditions.length * 150 },
    data: {
      label:
        config.action_type === 'promote'
          ? 'Promote to Winners'
          : config.action_type === 'pause'
            ? 'Pause Ad'
            : 'Activate Ad',
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
    edges.push({
      id: `e${i + 1}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
      animated: true,
    });
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
    date_preset: tc.date_preset || 'last_7d',
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
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
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
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={open ? query : displayName || query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder || 'Search campaigns...'}
          className="h-10 w-full rounded-lg border border-gray-200 pr-8 pl-9 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        {value && (
          <button
            onClick={() => {
              onChange('', '');
              setQuery('');
            }}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 hover:bg-gray-100"
          >
            <X className="h-3.5 w-3.5 text-gray-400" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
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
                className={`flex w-full items-center justify-between border-b border-gray-50 px-4 py-2.5 text-left last:border-0 hover:bg-gray-50 ${
                  c.id === value ? 'bg-blue-50' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-900">{c.name}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {c.objective} · {c.status}
                  </p>
                </div>
                {c.id === value && <Check className="ml-2 h-4 w-4 flex-shrink-0 text-blue-600" />}
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

  const searchAdSets = useCallback(
    async (q: string) => {
      setLoading(true);

      try {
        let url = `/api/automations/search?type=adsets&q=${encodeURIComponent(q)}`;

        if (campaignId) url += `&campaign_id=${campaignId}`;
        const res = await fetch(url);
        const data = await res.json();

        setResults(data.data || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [campaignId]
  );

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
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={open ? query : displayName || query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder || 'Search ad sets...'}
          className="h-10 w-full rounded-lg border border-gray-200 pr-8 pl-9 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        {value && (
          <button
            onClick={() => {
              onChange('', '');
              setQuery('');
            }}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 hover:bg-gray-100"
          >
            <X className="h-3.5 w-3.5 text-gray-400" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
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
                className={`flex w-full items-center justify-between border-b border-gray-50 px-4 py-2.5 text-left last:border-0 hover:bg-gray-50 ${
                  a.id === value ? 'bg-blue-50' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-900">{a.name}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {a.status}
                    {a.campaign_name ? ` · ${a.campaign_name}` : ''}
                  </p>
                </div>
                {a.id === value && <Check className="ml-2 h-4 w-4 flex-shrink-0 text-blue-600" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────── Copilot Parser ─────────── */

function parseCopilotInput(text: string): { config: Partial<RuleConfig>; ruleName: string } {
  const lowerText = text.toLowerCase();

  // Extract action type
  let actionType = 'pause';

  if (lowerText.match(/\b(promote|duplicate|scale)\b/)) {
    actionType = 'promote';
  } else if (lowerText.match(/\b(notify|alert|slack|send)\b/)) {
    actionType = 'notify';
  } else if (lowerText.match(/\b(pause|stop)\b/)) {
    actionType = 'pause';
  }

  // Extract campaign name: "in [name] campaign" or "in [name]"
  let campaignName = '';
  const campaignMatch =
    text.match(/\bin\s+["']?([^"'\n]+?)["']?\s+campaign\b/i) ||
    text.match(/\bin\s+["']?([^"'\n]+?)["']?\s*(?:\.|$)/i);

  if (campaignMatch) {
    campaignName = campaignMatch[1].trim();
  }

  // Extract date preset
  let datePreset = 'last_7d';

  if (lowerText.match(/\blast\s+30\s*d(?:ays?)?\b/)) datePreset = 'last_30d';
  else if (lowerText.match(/\blast\s+14\s*d(?:ays?)?\b/)) datePreset = 'last_14d';
  else if (lowerText.match(/\blast\s+3\s*d(?:ays?)?\b/)) datePreset = 'last_3d';
  else if (lowerText.match(/\btoday\b/)) datePreset = 'today';
  else if (lowerText.match(/\byesterday\b/)) datePreset = 'yesterday';
  else if (lowerText.match(/\blast\s+7\s*d(?:ays?)?\b/)) datePreset = 'last_7d';

  // Extract conditions: metric + operator + threshold
  const conditions: Condition[] = [];

  // Metric aliases
  const metricAliases: Record<string, string> = {
    cpa: 'cost_per_result',
    'cost per result': 'cost_per_result',
    'cost per acquisition': 'cost_per_result',
    spend: 'spend',
    spending: 'spend',
    spent: 'spend',
    cost: 'spend',
    results: 'results',
    conversions: 'results',
    leads: 'results',
    registrations: 'results',
    clicks: 'clicks',
    ctr: 'ctr',
    'click through rate': 'ctr',
    impressions: 'impressions',
  };

  // Operator patterns
  // Find condition phrases: "metric operator value"
  // Match: "CPA over $25", "spend > $30", "results >= 3", "0 results", etc.
  const simplifiedRegex =
    /(cpa|cost per result|cost per acquisition|spend|spending|spent|cost|results?|conversions?|leads?|registrations?|clicks?|ctr|click through rate|impressions?)\s+(?:is\s+)?(over|above|more than|greater than|exceeds?|under|below|less than|lower than|equal to|exactly|is|>=|<=|==)\s*(\$)?(\d+(?:\.\d+)?)/gi;

  let match;

  while ((match = simplifiedRegex.exec(text)) !== null) {
    const metricStr = match[1].trim().toLowerCase();
    const operatorStr = match[2].toLowerCase();
    const thresholdStr = match[4];

    // Find metric
    let metric = '';

    for (const [alias, value] of Object.entries(metricAliases)) {
      if (metricStr.includes(alias)) {
        metric = value;
        break;
      }
    }

    if (metric && thresholdStr) {
      // Determine operator
      let operator = '>=';

      if (operatorStr.match(/over|above|more|greater|exceeds|>=/)) operator = '>=';
      else if (operatorStr.match(/under|below|less|lower|<=/)) operator = '<=';
      else if (operatorStr.match(/equal|exactly|^is$/)) operator = '==';

      conditions.push({
        id: `c${conditions.length + 1}`,
        metric,
        operator,
        threshold: thresholdStr,
      });
    }
  }

  // Handle "0 results" pattern
  if (lowerText.match(/\b0\s+(results?|conversions?|leads?)\b/)) {
    conditions.push({
      id: `c${conditions.length + 1}`,
      metric: 'results',
      operator: '==',
      threshold: '0',
    });
  }

  // Default to at least one condition if none found
  if (conditions.length === 0) {
    conditions.push({
      id: 'c1',
      metric: 'spend',
      operator: '>=',
      threshold: '30',
    });
  }

  // Generate rule name from input (truncate to ~50 chars)
  const ruleName = text.length > 50 ? text.substring(0, 47) + '...' : text;

  const config: Partial<RuleConfig> = {
    entity_type: 'ad',
    campaign_name: campaignName,
    campaign_id: '', // Will be filled by campaign search
    adset_filter: 'all',
    schedule: 'hourly',
    date_preset: datePreset,
    conditions,
    action_type: actionType,
    target_adset_id: '',
    target_adset_name: '',
    also_notify_slack: actionType === 'notify',
    slack_channel: actionType === 'notify' ? '#emily-space' : '',
    slack_message: '',
  };

  return { config, ruleName };
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
      className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-gray-50"
    >
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          isComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
        }`}
      >
        {isComplete ? <Check className="h-4 w-4" /> : number}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
      </div>
      {isOpen ? (
        <ChevronUp className="h-4 w-4 flex-shrink-0 text-gray-400" />
      ) : (
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
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
          <h3 className="text-sm font-semibold text-gray-900">Copilot</h3>
          <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
            AI beta
          </span>
        </div>

        <p className="mb-3 text-xs text-gray-600">
          Describe what you want to automate in plain English
        </p>

        <div className="space-y-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pause ads with CPA over $25 in Brad campaign... or promote ads with CPA under $16 and results above 3"
            disabled={isSubmitting}
            className="h-24 w-full resize-none rounded-lg border border-blue-200 bg-white p-3 text-sm text-gray-900 placeholder-gray-400 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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

  // Run Now state
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<any>(null);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [confirmRunRule, setConfirmRunRule] = useState<Rule | null>(null);

  // Activity log
  const [activityLog, setActivityLog] = useState<any[]>([]);

  /* ─── API ─── */
  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/automations/rules');
      const data = await res.json();

      setRules(data.data || []);
    } catch (err) {
      console.error('Failed to fetch rules:', err);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/automations/history');
      const data = await res.json();

      setActivityLog(data.data || []);
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  }, []);

  useEffect(() => {
    fetchRules();
    fetchHistory();
  }, [fetchRules, fetchHistory]);

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
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      await fetch(`/api/automations/rules?id=${ruleId}`, { method: 'DELETE' });
      fetchRules();
      if (selectedRule?.id === ruleId) setSelectedRule(null);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleToggle = async (rule: Rule) => {
    try {
      await fetch('/api/automations/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rule.id, is_active: !rule.is_active }),
      });
      fetchRules();
    } catch (err) {
      console.error('Toggle failed:', err);
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
      await fetch('/api/automations/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_name: rule.name,
          type: 'live',
          matched: data.matched || 0,
          results: data.results || [],
        }),
      });
      fetchHistory();
    } catch (err) {
      setRunResults({ error: String(err) });
      setRunDialogOpen(true);
    } finally {
      setRunningRuleId(null);
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
  const getRuleSummary = (rule: Rule) => {
    const cfg = nodesToConfig(rule.nodes);

    return cfg;
  };

  /* ─────────── RENDER ─────────── */
  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-5">
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
            <h1 className="text-2xl font-bold text-gray-900">
              {viewMode === 'list' ? 'Automations' : selectedRule ? 'Edit Rule' : 'New Rule'}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {viewMode === 'list'
                ? 'Rules that automatically manage your ads'
                : 'Configure your automation step by step'}
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
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save Rule'}
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
              <h2 className="mb-4 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Templates
              </h2>
              <div className="grid grid-cols-1 gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => applyTemplate(t)}
                    className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left transition-all hover:border-gray-300 hover:shadow-sm"
                  >
                    <span className="text-xl">{t.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{t.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{t.description}</p>
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
              <h2 className="mb-4 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Your Rules {rules.length > 0 && `(${rules.length})`}
              </h2>
              {rules.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-12 text-center">
                  <Zap className="mx-auto mb-3 h-8 w-8 text-gray-300" />
                  <p className="text-sm text-gray-500">No rules yet</p>
                  <p className="mt-1 text-xs text-gray-400">Pick a template or create a new rule</p>
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
                        className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4"
                      >
                        <button
                          onClick={() => handleToggle(rule)}
                          className="flex-shrink-0"
                          title={rule.is_active ? 'Pause rule' : 'Enable rule'}
                        >
                          {rule.is_active ? (
                            <ToggleRight className="h-7 w-7 text-emerald-500" />
                          ) : (
                            <ToggleLeft className="h-7 w-7 text-gray-300" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p
                              className={`text-sm font-medium ${rule.is_active ? 'text-gray-900' : 'text-gray-400'}`}
                            >
                              {rule.name}
                            </p>
                            <span
                              className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                rule.is_active
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-gray-100 text-gray-400'
                              }`}
                            >
                              {rule.is_active ? 'Active' : 'Off'}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
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
                            <p className="mt-0.5 truncate text-xs text-gray-400">
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
                            <Settings2 className="h-3.5 w-3.5 text-gray-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleDelete(rule.id)}
                          >
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
              <h2 className="mb-4 text-xs font-semibold tracking-wider text-gray-400 uppercase">
                Activity Log {activityLog.length > 0 && `(${activityLog.length})`}
              </h2>
              {activityLog.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-8 text-center">
                  <Activity className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                  <p className="text-sm text-gray-500">No runs yet</p>
                  <p className="mt-1 text-xs text-gray-400">
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
                        className="rounded-xl border border-gray-200 bg-white p-4"
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
                            <p className="text-sm font-medium text-gray-900">{event.rule_name}</p>
                          </div>
                          <p className="text-xs text-gray-400">{timeStr}</p>
                        </div>
                        <div className="mt-2 text-xs text-gray-500">
                          {event.matched === 0 ? (
                            <p>No ads matched the conditions</p>
                          ) : (
                            <div className="space-y-1.5">
                              <p>
                                <span className="font-medium text-gray-700">{event.matched}</span>{' '}
                                ad{event.matched !== 1 ? 's' : ''} matched
                              </p>
                              {event.results?.map((r: any, i: number) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between border-l-2 border-gray-100 pl-3"
                                >
                                  <span className="truncate text-gray-700">{r.entity_name}</span>
                                  <div className="ml-2 flex flex-shrink-0 items-center gap-2">
                                    <span className="text-gray-400">
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
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <div className="mx-auto max-w-2xl space-y-4 px-8 py-6">
            {/* Rule Name */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <label className="text-xs font-semibold tracking-wider text-gray-500 uppercase">
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
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
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
                <div className="space-y-4 border-t border-gray-100 px-5 pt-4 pb-5">
                  {/* Entity type */}
                  <div>
                    <label className="text-xs font-medium tracking-wider text-gray-500 uppercase">
                      Entity Level
                    </label>
                    <div className="mt-2 flex gap-2">
                      {['ad', 'adset', 'campaign'].map((type) => (
                        <button
                          key={type}
                          onClick={() => updateConfig({ entity_type: type })}
                          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                            config.entity_type === type
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          {type === 'ad' ? 'Ads' : type === 'adset' ? 'Ad Sets' : 'Campaigns'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Campaign selector */}
                  <div>
                    <label className="text-xs font-medium tracking-wider text-gray-500 uppercase">
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
                    <p className="mt-1.5 text-xs text-gray-400">
                      Leave empty to apply to all campaigns
                    </p>
                  </div>

                  {/* Schedule */}
                  <div>
                    <label className="text-xs font-medium tracking-wider text-gray-500 uppercase">
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
                    <label className="text-xs font-medium tracking-wider text-gray-500 uppercase">
                      Performance Period
                    </label>
                    <SelectNative
                      value={config.date_preset}
                      onChange={(e) => updateConfig({ date_preset: e.target.value })}
                      options={DATE_PRESET_OPTIONS}
                      className="mt-2"
                    />
                    <p className="mt-1.5 text-xs text-gray-400">
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
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
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
                <div className="space-y-3 border-t border-gray-100 px-5 pt-4 pb-5">
                  <p className="text-xs text-gray-500">All conditions must be met (AND logic)</p>

                  {config.conditions.map((cond, i) => (
                    <div key={cond.id} className="flex items-start gap-2">
                      {i > 0 && (
                        <span className="mt-2 rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-400">
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
                        className={`mt-2 rounded p-1 hover:bg-gray-100 ${config.conditions.length <= 1 ? 'cursor-not-allowed opacity-30' : ''}`}
                        disabled={config.conditions.length <= 1}
                      >
                        <X className="h-4 w-4 text-gray-400" />
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
                  <div className="mt-4 border-t border-gray-100 pt-4">
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
                        <span className="text-sm text-gray-600">
                          <span className="font-semibold text-gray-900">{previewAds.length}</span>{' '}
                          of {previewTotal} ads match
                        </span>
                      )}
                    </div>

                    {previewLoaded && previewAds.length > 0 && (
                      <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-gray-500">
                                Ad Name
                              </th>
                              <th className="px-3 py-2 text-right font-medium text-gray-500">
                                Spend
                              </th>
                              <th className="px-3 py-2 text-right font-medium text-gray-500">
                                Results
                              </th>
                              <th className="px-3 py-2 text-right font-medium text-gray-500">
                                CPA
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {previewAds.slice(0, 10).map((ad) => (
                              <tr key={ad.ad_id} className="hover:bg-gray-50">
                                <td className="max-w-[200px] truncate px-3 py-2 text-gray-900">
                                  {ad.ad_name}
                                </td>
                                <td className="px-3 py-2 text-right text-gray-600">${ad.spend}</td>
                                <td className="px-3 py-2 text-right text-gray-600">{ad.results}</td>
                                <td className="px-3 py-2 text-right text-gray-600">
                                  {ad.cpa === 'N/A' ? '—' : `$${ad.cpa}`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {previewAds.length > 10 && (
                          <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-400">
                            + {previewAds.length - 10} more ads
                          </div>
                        )}
                      </div>
                    )}

                    {previewLoaded && previewAds.length === 0 && (
                      <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-center">
                        <p className="text-sm text-gray-500">
                          No ads currently match these conditions
                        </p>
                        <p className="mt-1 text-xs text-gray-400">
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
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
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
                <div className="space-y-4 border-t border-gray-100 px-5 pt-4 pb-5">
                  {/* Action type */}
                  <div>
                    <label className="text-xs font-medium tracking-wider text-gray-500 uppercase">
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
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          {action.icon}
                          <div>
                            <p className="text-sm font-medium">{action.label}</p>
                            <p
                              className={`text-[10px] ${config.action_type === action.value ? 'text-gray-300' : 'text-gray-400'}`}
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
                      <label className="text-xs font-medium tracking-wider text-gray-500 uppercase">
                        Target Ad Set{' '}
                        <span className="font-normal text-gray-400 normal-case">
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
                  <div className="border-t border-gray-100 pt-4">
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={config.also_notify_slack}
                        onChange={(e) =>
                          updateConfig({
                            also_notify_slack: e.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                      />
                      <span className="text-sm font-medium text-gray-700">
                        Send Slack notification
                      </span>
                    </label>

                    {config.also_notify_slack && (
                      <div className="mt-3 ml-6 space-y-3">
                        <div>
                          <label className="text-xs font-medium tracking-wider text-gray-500 uppercase">
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
                            placeholder="#emily-space"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium tracking-wider text-gray-500 uppercase">
                            Custom Message{' '}
                            <span className="font-normal text-gray-400 normal-case">
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
                            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
                              <p className="mb-1.5 text-[10px] font-medium tracking-wider text-gray-500 uppercase">
                                Message Preview
                              </p>
                              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm whitespace-pre-wrap text-gray-700">
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
                                <p className="mt-1 text-[10px] text-gray-400">
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
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Summary</h3>
                <div className="space-y-2 text-sm text-gray-600">
                  <p>
                    <span className="text-gray-400">Apply to:</span>{' '}
                    {config.entity_type === 'ad'
                      ? 'All ads'
                      : config.entity_type === 'adset'
                        ? 'All ad sets'
                        : 'Campaigns'}
                    {config.campaign_name && ` in "${config.campaign_name}"`}
                  </p>
                  <p>
                    <span className="text-gray-400">When:</span>{' '}
                    {config.conditions.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && <span className="text-gray-400"> AND </span>}
                        <span className="font-medium text-gray-800">
                          {METRIC_OPTIONS.find((m) => m.value === c.metric)?.label} {c.operator}{' '}
                          {c.threshold}
                        </span>
                      </span>
                    ))}
                  </p>
                  <p>
                    <span className="text-gray-400">Then:</span>{' '}
                    <span className="font-medium text-gray-800 capitalize">
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
                    <span className="text-gray-400">Frequency:</span>{' '}
                    {SCHEDULE_LABELS[config.schedule]} ·{' '}
                    {DATE_PRESET_OPTIONS.find((d) => d.value === config.date_preset)?.label ||
                      config.date_preset}
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestWorkflow}
                    disabled={testing}
                  >
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    {testing ? 'Testing...' : 'Test Rule'}
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
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
          <div className="mt-2 max-h-[400px] space-y-3 overflow-y-auto">
            {testResults?.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-700">{testResults.error}</p>
              </div>
            ) : testResults?.matched === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center">
                <p className="text-sm font-medium text-gray-600">No ads matched the conditions</p>
                <p className="mt-1 text-xs text-gray-400">
                  Either no ads meet the thresholds, or check the campaign filter.
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">{testResults?.matched || 0}</span> ad
                  {testResults?.matched !== 1 ? 's' : ''} would be affected:
                </p>
                {testResults?.results?.map((r: any, i: number) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-sm font-medium text-gray-900">{r.entity_name}</p>
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
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
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
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center">
                <p className="text-sm font-medium text-gray-600">No ads matched the conditions</p>
                <p className="mt-1 text-xs text-gray-400">No actions were taken.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">{runResults?.matched || 0}</span> ad
                  {runResults?.matched !== 1 ? 's' : ''} affected:
                </p>
                {runResults?.results?.map((r: any, i: number) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-sm font-medium text-gray-900">{r.entity_name}</p>
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
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
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
