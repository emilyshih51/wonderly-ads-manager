/**
 * Pure functions and types for converting between automation rule configs
 * and node/edge graph representations.
 */

import type { AutomationNode, AutomationEdge } from '@/types';

/* ─────────── Node Config Interfaces ─────────── */

export interface TriggerNodeConfig {
  entity_type?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_filter?: string;
  adset_name?: string;
  schedule?: string;
  date_preset?: string;
}

export interface ActionNodeConfig {
  action_type?: string;
  target_adset_id?: string;
  target_adset_name?: string;
  also_notify_slack?: string | boolean;
  slack_channel?: string;
  slack_message?: string;
}

export interface ConditionNodeConfig {
  metric?: string;
  operator?: string;
  threshold?: string;
}

/* ─────────── Shared Types ─────────── */

export interface Condition {
  id: string;
  metric: string;
  operator: string;
  threshold: string;
}

export interface RuleConfig {
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

/* ─────────── Constants ─────────── */

export const METRIC_OPTIONS = [
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

/* ─────────── Config → Nodes/Edges ─────────── */

export function configToNodes(config: RuleConfig) {
  const nodes: AutomationNode[] = [
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
        } satisfies TriggerNodeConfig,
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
        config: {
          metric: cond.metric,
          operator: cond.operator,
          threshold: cond.threshold,
        } satisfies ConditionNodeConfig,
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
      } satisfies ActionNodeConfig,
    },
  });

  const edges: AutomationEdge[] = [];

  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `e${i + 1}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
    });
  }

  return { nodes, edges };
}

/* ─────────── Nodes → Config ─────────── */

export function nodesToConfig(nodes: AutomationNode[]): RuleConfig {
  const trigger = nodes.find((n) => n.type === 'trigger');
  const condNodes = nodes.filter((n) => n.type === 'condition');
  const action = nodes.find((n) => n.type === 'action');
  const tc = (trigger?.data?.config ?? {}) as TriggerNodeConfig;
  const ac = (action?.data?.config ?? {}) as ActionNodeConfig;

  return {
    entity_type: tc.entity_type || 'ad',
    campaign_id: tc.campaign_id || '',
    campaign_name: tc.campaign_name || '',
    adset_filter: tc.adset_filter || 'all',
    adset_name: tc.adset_name || '',
    schedule: tc.schedule || 'hourly',
    date_preset: tc.date_preset || 'last_7d',
    conditions: condNodes.map((n, i) => {
      const cc = (n.data?.config ?? {}) as ConditionNodeConfig;

      return {
        id: n.id || `c${i + 1}`,
        metric: cc.metric || 'spend',
        operator: cc.operator || '>=',
        threshold: cc.threshold || '',
      };
    }),
    action_type: ac.action_type || 'pause',
    target_adset_id: ac.target_adset_id || '',
    target_adset_name: ac.target_adset_name || '',
    also_notify_slack: ac.also_notify_slack === 'true' || ac.also_notify_slack === true,
    slack_channel: ac.slack_channel || '',
    slack_message: ac.slack_message || '',
  };
}

/* ─────────── Copilot Parser ─────────── */

export function parseCopilotInput(text: string): { config: Partial<RuleConfig>; ruleName: string } {
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
    slack_channel: '',
    slack_message: '',
  };

  return { config, ruleName };
}
