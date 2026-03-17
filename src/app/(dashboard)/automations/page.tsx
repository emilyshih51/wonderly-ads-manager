'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  Panel,
  Handle,
  Position,
  NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Plus, Save, Trash2, Zap, Play, Pause,
  LayoutList, Workflow, ArrowLeft, Clock,
  AlertTriangle, TrendingDown, DollarSign,
  Eye, ShieldAlert, ToggleLeft, ToggleRight,
  ChevronRight, Settings2,
} from 'lucide-react';

/* ─────────── Pre-built templates ─────────── */

interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;        // tailwind bg color
  iconColor: string;    // tailwind text color
  category: 'protect' | 'optimize' | 'alert';
  nodes: Node[];
  edges: Edge[];
}

/*
 * NOTE: campaign_id and target_adset_id are stored in node configs.
 * To reuse these rules for other campaigns, just change the campaign_id in the trigger
 * and the target_adset_id in the action via the canvas editor.
 *
 * Default campaign: "Wonderly | Testing | Website Signup (D)"
 * Default winners ad set: in "Wonderly | USA-CA | M-F | 18-65+ | Broad Targeting | 03/02 - Winners"
 * These IDs will be populated when the user first configures the rules.
 */

const TEMPLATES: AutomationTemplate[] = [
  {
    id: 'pause-zero-results',
    name: 'Pause ad: spend ≥ $30, 0 results',
    description: 'Pause any ad spending $30+ with zero conversions. Notifies Slack with a link to the ad.',
    icon: <ShieldAlert className="h-5 w-5" />,
    color: 'bg-gray-50 border border-gray-200',
    iconColor: 'text-red-500',
    category: 'protect',
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 300, y: 50 }, data: { label: 'Scan Ads in Campaign', config: { entity_type: 'ad', schedule: 'hourly', campaign_id: '' } } },
      { id: 'c1', type: 'condition', position: { x: 300, y: 200 }, data: { label: 'Spend ≥ $30', config: { metric: 'spend', operator: '>=', threshold: '30' } } },
      { id: 'c2', type: 'condition', position: { x: 300, y: 350 }, data: { label: '0 Results', config: { metric: 'results', operator: '==', threshold: '0' } } },
      { id: 'a1', type: 'action', position: { x: 300, y: 500 }, data: { label: 'Pause Ad + Slack', config: { action_type: 'pause', also_notify_slack: 'true', slack_channel: '#emily-space' } } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'c1', animated: true },
      { id: 'e2', source: 'c1', target: 'c2', animated: true },
      { id: 'e3', source: 'c2', target: 'a1', animated: true },
    ],
  },
  {
    id: 'pause-high-cpa',
    name: 'Pause ad: spend ≥ $30, CPA ≥ $25',
    description: 'Pause any ad spending $30+ with CPA at or above $25. Notifies Slack with a link to the ad.',
    icon: <DollarSign className="h-5 w-5" />,
    color: 'bg-gray-50 border border-gray-200',
    iconColor: 'text-amber-500',
    category: 'protect',
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 300, y: 50 }, data: { label: 'Scan Ads in Campaign', config: { entity_type: 'ad', schedule: 'hourly', campaign_id: '' } } },
      { id: 'c1', type: 'condition', position: { x: 300, y: 200 }, data: { label: 'Spend ≥ $30', config: { metric: 'spend', operator: '>=', threshold: '30' } } },
      { id: 'c2', type: 'condition', position: { x: 300, y: 350 }, data: { label: 'CPA ≥ $25', config: { metric: 'cost_per_result', operator: '>=', threshold: '25' } } },
      { id: 'a1', type: 'action', position: { x: 300, y: 500 }, data: { label: 'Pause Ad + Slack', config: { action_type: 'pause', also_notify_slack: 'true', slack_channel: '#emily-space' } } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'c1', animated: true },
      { id: 'e2', source: 'c1', target: 'c2', animated: true },
      { id: 'e3', source: 'c2', target: 'a1', animated: true },
    ],
  },
  {
    id: 'promote-low-cpa-3',
    name: 'Promote ad: CPA ≤ $15, results ≥ 3',
    description: 'Pause the ad in testing and duplicate it to the Winners ad set. Notifies Slack.',
    icon: <TrendingDown className="h-5 w-5" />,
    color: 'bg-gray-50 border border-gray-200',
    iconColor: 'text-emerald-500',
    category: 'optimize',
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 300, y: 50 }, data: { label: 'Scan Ads in Campaign', config: { entity_type: 'ad', schedule: 'hourly', campaign_id: '' } } },
      { id: 'c1', type: 'condition', position: { x: 300, y: 200 }, data: { label: 'CPA ≤ $15', config: { metric: 'cost_per_result', operator: '<=', threshold: '15' } } },
      { id: 'c2', type: 'condition', position: { x: 300, y: 350 }, data: { label: 'Results ≥ 3', config: { metric: 'results', operator: '>=', threshold: '3' } } },
      { id: 'a1', type: 'action', position: { x: 300, y: 500 }, data: { label: 'Promote to Winners', config: { action_type: 'promote', also_notify_slack: 'true', slack_channel: '#emily-space', target_adset_id: '' } } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'c1', animated: true },
      { id: 'e2', source: 'c1', target: 'c2', animated: true },
      { id: 'e3', source: 'c2', target: 'a1', animated: true },
    ],
  },
  {
    id: 'promote-low-cpa-5',
    name: 'Promote ad: CPA ≤ $20, results ≥ 5',
    description: 'Pause the ad in testing and duplicate it to the Winners ad set. Notifies Slack.',
    icon: <TrendingDown className="h-5 w-5" />,
    color: 'bg-gray-50 border border-gray-200',
    iconColor: 'text-emerald-500',
    category: 'optimize',
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 300, y: 50 }, data: { label: 'Scan Ads in Campaign', config: { entity_type: 'ad', schedule: 'hourly', campaign_id: '' } } },
      { id: 'c1', type: 'condition', position: { x: 300, y: 200 }, data: { label: 'CPA ≤ $20', config: { metric: 'cost_per_result', operator: '<=', threshold: '20' } } },
      { id: 'c2', type: 'condition', position: { x: 300, y: 350 }, data: { label: 'Results ≥ 5', config: { metric: 'results', operator: '>=', threshold: '5' } } },
      { id: 'a1', type: 'action', position: { x: 300, y: 500 }, data: { label: 'Promote to Winners', config: { action_type: 'promote', also_notify_slack: 'true', slack_channel: '#emily-space', target_adset_id: '' } } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'c1', animated: true },
      { id: 'e2', source: 'c1', target: 'c2', animated: true },
      { id: 'e3', source: 'c2', target: 'a1', animated: true },
    ],
  },
];

/* ─────────── Zapier-style node components ─────────── */

function ZapierTriggerNode({ data }: NodeProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm min-w-[260px] hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 border border-orange-200">
          <Zap className="h-4 w-4 text-orange-500" />
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Trigger</p>
          <p className="text-sm font-medium text-gray-800">{data.label}</p>
        </div>
      </div>
      <div className="px-4 py-2 text-xs text-gray-400">
        {data.config?.entity_type && <span className="capitalize">{data.config.entity_type}</span>}
        {data.config?.schedule && <span> · {data.config.schedule}</span>}
        {data.config?.campaign_id && <span> · campaign {data.config.campaign_id.slice(-6)}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-300 !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  );
}

function ZapierConditionNode({ data }: NodeProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm min-w-[260px] hover:shadow-md transition-shadow">
      <Handle type="target" position={Position.Top} className="!bg-gray-300 !w-2.5 !h-2.5 !border-2 !border-white" />
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-200">
          <Eye className="h-4 w-4 text-indigo-500" />
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Condition</p>
          <p className="text-sm font-medium text-gray-800">{data.label}</p>
        </div>
      </div>
      <div className="px-4 py-2 text-xs text-gray-400">
        {data.config?.metric && <span>{data.config.metric} {data.config.operator} {data.config.threshold}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-300 !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  );
}

function ZapierActionNode({ data }: NodeProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm min-w-[260px] hover:shadow-md transition-shadow">
      <Handle type="target" position={Position.Top} className="!bg-gray-300 !w-2.5 !h-2.5 !border-2 !border-white" />
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 border border-emerald-200">
          <Play className="h-4 w-4 text-emerald-500" />
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Action</p>
          <p className="text-sm font-medium text-gray-800">{data.label}</p>
        </div>
      </div>
      <div className="px-4 py-2 text-xs text-gray-400">
        {data.config?.action_type && <span className="capitalize">{data.config.action_type}</span>}
        {data.config?.also_notify_slack === 'true' && data.config?.slack_channel && <span> → {data.config.slack_channel}</span>}
        {data.config?.also_notify_slack === 'true' && !data.config?.slack_channel && <span> + Slack</span>}
      </div>
    </div>
  );
}

/* ─────────── Constants ─────────── */

const nodeTypes = {
  trigger: ZapierTriggerNode,
  condition: ZapierConditionNode,
  action: ZapierActionNode,
};

const SCHEDULE_OPTIONS = [
  { label: 'Every 15 minutes', value: '15min' },
  { label: 'Every hour', value: 'hourly' },
  { label: 'Every 6 hours', value: '6hours' },
  { label: 'Daily', value: 'daily' },
];

const SCHEDULE_LABELS: Record<string, string> = {
  '15min': 'Every 15 min', 'hourly': 'Every hour', '6hours': 'Every 6 hours', 'daily': 'Daily',
};

/* ─────────── Main Component ─────────── */

interface Rule {
  id: string;
  name: string;
  is_active: boolean;
  nodes: Node[];
  edges: Edge[];
}

export default function AutomationsPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [saving, setSaving] = useState(false);

  const [viewMode, setViewMode] = useState<'list' | 'canvas'>('list');
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [nodeConfig, setNodeConfig] = useState<Record<string, string>>({});

  const memoizedNodeTypes = useMemo(() => nodeTypes, []);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => addEdge({
        ...params,
        animated: true,
        style: { stroke: '#d1d5db', strokeWidth: 1.5 },
      }, eds)),
    [setEdges]
  );

  /* ─── API ─── */
  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/automations/rules');
      const data = await res.json();
      setRules(data.data || []);
    } catch (err) { console.error('Failed to fetch rules:', err); }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const method = selectedRule ? 'PUT' : 'POST';
      const body = {
        ...(selectedRule && { id: selectedRule.id }),
        name: ruleName,
        is_active: selectedRule?.is_active ?? false, // Start paused by default
        nodes, edges,
      };
      await fetch('/api/automations/rules', {
        method, headers: { 'Content-Type': 'application/json' },
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
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rule.id, is_active: !rule.is_active }),
      });
      fetchRules();
    } catch (err) { console.error('Toggle failed:', err); }
  };

  const useTemplate = (template: AutomationTemplate) => {
    setSelectedRule(null);
    setRuleName(template.name);
    setNodes(template.nodes);
    setEdges(template.edges);
    setViewMode('canvas');
  };

  const editRule = (rule: Rule) => {
    setSelectedRule(rule);
    setRuleName(rule.name);
    setNodes(rule.nodes);
    setEdges(rule.edges);
    setViewMode('canvas');
  };

  const newBlank = () => {
    setSelectedRule(null);
    setRuleName('New Automation');
    setNodes([
      { id: 't1', type: 'trigger', position: { x: 300, y: 50 }, data: { label: 'Check Performance', config: { entity_type: 'adset', schedule: 'hourly' } } },
      { id: 'c1', type: 'condition', position: { x: 300, y: 200 }, data: { label: 'Set Condition', config: {} } },
      { id: 'a1', type: 'action', position: { x: 300, y: 350 }, data: { label: 'Take Action', config: {} } },
    ]);
    setEdges([
      { id: 'e1', source: 't1', target: 'c1', animated: true, style: { stroke: '#d1d5db', strokeWidth: 1.5 } },
      { id: 'e2', source: 'c1', target: 'a1', animated: true, style: { stroke: '#d1d5db', strokeWidth: 1.5 } },
    ]);
    setViewMode('canvas');
  };

  const addNode = (type: 'trigger' | 'condition' | 'action') => {
    const id = `${type}-${Date.now()}`;
    const defaults: Record<string, { label: string }> = {
      trigger: { label: 'New Trigger' },
      condition: { label: 'New Condition' },
      action: { label: 'New Action' },
    };
    setNodes((nds) => [...nds, {
      id, type,
      position: { x: 300, y: (nds.length + 1) * 160 },
      data: { ...defaults[type], config: {} },
    }]);
  };

  const onNodeDoubleClick = (_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setNodeConfig(Object.fromEntries(Object.entries(node.data.config || {}).map(([k, v]) => [k, String(v)])));
    setConfigDialogOpen(true);
  };

  const saveNodeConfig = () => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) => n.id === selectedNode.id ? { ...n, data: { ...n.data, config: nodeConfig } } : n)
    );
    setConfigDialogOpen(false);
  };

  /* ─── Helpers ─── */
  const getCategoryLabel = (cat: string) => {
    if (cat === 'protect') return 'Spend Protection';
    if (cat === 'optimize') return 'Performance';
    return 'Alerts';
  };

  const getRuleSummary = (rule: Rule) => {
    const trigger = rule.nodes.find((n) => n.type === 'trigger');
    const conditions = rule.nodes.filter((n) => n.type === 'condition');
    const action = rule.nodes.find((n) => n.type === 'action');
    return { trigger, conditions, action };
  };

  /* ─────────── RENDER ─────────── */
  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Automations</h1>
          <p className="mt-1 text-sm text-gray-500">
            {viewMode === 'list' ? 'Rules that automatically manage your ads' : 'Build your automation workflow'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'canvas' && (
            <Button variant="ghost" size="sm" onClick={() => setViewMode('list')}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )}
          {viewMode === 'list' && (
            <Button size="sm" onClick={newBlank}>
              <Plus className="h-4 w-4 mr-1" /> Custom Rule
            </Button>
          )}
        </div>
      </div>

      {/* ─── LIST VIEW ─── */}
      {viewMode === 'list' && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 py-8 space-y-10">

            {/* Templates Section */}
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Templates</h2>
              <div className="grid grid-cols-1 gap-3">
                {TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => useTemplate(template)}
                    className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-sm transition-all text-left group"
                  >
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${template.color} flex-shrink-0`}>
                      <span className={template.iconColor}>{template.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{template.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{template.description}</p>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-xs text-blue-600 font-medium">Use template</span>
                      <ChevronRight className="h-4 w-4 text-blue-600" />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Active Rules Section */}
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                Your Rules {rules.length > 0 && `(${rules.length})`}
              </h2>

              {rules.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <Workflow className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500 mb-1">No rules yet</p>
                  <p className="text-xs text-gray-400">Pick a template above or create a custom rule</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule) => {
                    const { trigger, conditions, action } = getRuleSummary(rule);
                    return (
                      <div
                        key={rule.id}
                        className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl"
                      >
                        {/* Toggle */}
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

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium ${rule.is_active ? 'text-gray-900' : 'text-gray-400'}`}>
                              {rule.name}
                            </p>
                            <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              rule.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'
                            }`}>
                              {rule.is_active ? 'Active' : 'Off'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-400 flex-wrap">
                            <span>{trigger?.data?.config?.entity_type || 'adset'}</span>
                            <span>·</span>
                            <span>{SCHEDULE_LABELS[trigger?.data?.config?.schedule] || 'hourly'}</span>
                            <span>·</span>
                            <span>{conditions.length} condition{conditions.length !== 1 ? 's' : ''}</span>
                            <span>·</span>
                            <span className="capitalize">{action?.data?.config?.action_type || 'pause'}</span>
                            {action?.data?.config?.slack_channel && (
                              <><span>·</span><span>{action.data.config.slack_channel}</span></>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
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
          </div>
        </div>
      )}

      {/* ─── CANVAS VIEW (Zapier-style) ─── */}
      {viewMode === 'canvas' && (
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={memoizedNodeTypes}
            fitView
            className="bg-slate-50"
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: '#d1d5db', strokeWidth: 1.5 },
            }}
          >
            <Background color="#f1f5f9" gap={20} size={1} />
            <Controls
              className="!rounded-xl !border-gray-200 !shadow-sm !bg-white"
            />

            {/* Top bar */}
            <Panel position="top-center" className="flex items-center gap-3 bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200 px-4 py-2.5 mt-3">
              <Input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                className="w-56 h-8 text-sm border-0 bg-transparent font-medium focus:ring-0 px-0"
                placeholder="Rule name..."
              />
              <div className="w-px h-6 bg-gray-200" />
              <Button size="sm" onClick={handleSave} disabled={saving} className="h-8">
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {saving ? 'Saving...' : 'Save Rule'}
              </Button>
            </Panel>

            {/* Side panel: Add nodes */}
            <Panel position="top-right" className="flex flex-col gap-1.5 bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-gray-200 p-3 mt-3 mr-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Add Step</p>
              <button
                onClick={() => addNode('trigger')}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Zap className="h-3.5 w-3.5 text-orange-400" /> Trigger
              </button>
              <button
                onClick={() => addNode('condition')}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Eye className="h-3.5 w-3.5 text-indigo-400" /> Condition
              </button>
              <button
                onClick={() => addNode('action')}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Play className="h-3.5 w-3.5 text-emerald-400" /> Action
              </button>
            </Panel>
          </ReactFlow>
        </div>
      )}

      {/* ─── Node Config Dialog ─── */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              Configure {selectedNode?.type === 'trigger' ? 'Trigger' : selectedNode?.type === 'condition' ? 'Condition' : 'Action'}
            </DialogTitle>
            <DialogDescription className="text-xs">Double-click any node to edit.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Label */}
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Label</label>
              <Input
                value={selectedNode?.data?.label || ''}
                onChange={(e) => {
                  if (selectedNode) {
                    setNodes((nds) =>
                      nds.map((n) => n.id === selectedNode.id ? { ...n, data: { ...n.data, label: e.target.value } } : n)
                    );
                  }
                }}
                className="mt-1 h-9"
              />
            </div>

            {selectedNode?.type === 'trigger' && (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Entity Type</label>
                  <SelectNative
                    value={nodeConfig.entity_type || 'adset'}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, entity_type: e.target.value })}
                    options={[
                      { label: 'Campaign', value: 'campaign' },
                      { label: 'Ad Set', value: 'adset' },
                      { label: 'Ad', value: 'ad' },
                    ]}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign ID <span className="normal-case text-gray-400 font-normal">(scope to specific campaign)</span></label>
                  <Input
                    value={nodeConfig.campaign_id || ''}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, campaign_id: e.target.value })}
                    className="mt-1 h-9"
                    placeholder="Leave empty for all campaigns"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Check Frequency</label>
                  <SelectNative
                    value={nodeConfig.schedule || 'hourly'}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, schedule: e.target.value })}
                    options={SCHEDULE_OPTIONS}
                    className="mt-1"
                  />
                </div>
              </>
            )}

            {selectedNode?.type === 'condition' && (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Metric</label>
                  <SelectNative
                    value={nodeConfig.metric || 'spend'}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, metric: e.target.value })}
                    options={[
                      { label: 'Spend', value: 'spend' },
                      { label: 'Results', value: 'results' },
                      { label: 'Cost per Result (CPA)', value: 'cost_per_result' },
                      { label: 'Impressions', value: 'impressions' },
                      { label: 'Clicks', value: 'clicks' },
                      { label: 'CTR', value: 'ctr' },
                      { label: 'CPC', value: 'cpc' },
                      { label: 'CPM', value: 'cpm' },
                      { label: 'Frequency', value: 'frequency' },
                    ]}
                    className="mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Operator</label>
                    <SelectNative
                      value={nodeConfig.operator || '>'}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, operator: e.target.value })}
                      options={[
                        { label: '>', value: '>' },
                        { label: '<', value: '<' },
                        { label: '>=', value: '>=' },
                        { label: '<=', value: '<=' },
                        { label: '=', value: '==' },
                      ]}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Threshold</label>
                    <Input
                      type="number"
                      value={nodeConfig.threshold || ''}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, threshold: e.target.value })}
                      className="mt-1 h-9"
                      placeholder="50"
                    />
                  </div>
                </div>
              </>
            )}

            {selectedNode?.type === 'action' && (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Action</label>
                  <SelectNative
                    value={nodeConfig.action_type || 'pause'}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, action_type: e.target.value })}
                    options={[
                      { label: 'Pause', value: 'pause' },
                      { label: 'Promote (pause + duplicate to winners)', value: 'promote' },
                      { label: 'Activate', value: 'activate' },
                      { label: 'Slack notification only', value: 'slack_notify' },
                    ]}
                    className="mt-1"
                  />
                </div>
                {nodeConfig.action_type === 'promote' && (
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Target Ad Set ID <span className="normal-case text-gray-400 font-normal">(winners ad set)</span></label>
                    <Input
                      value={nodeConfig.target_adset_id || ''}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, target_adset_id: e.target.value })}
                      className="mt-1 h-9"
                      placeholder="Ad set ID to duplicate winning ads into"
                    />
                  </div>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nodeConfig.also_notify_slack === 'true'}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, also_notify_slack: String(e.target.checked) })}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">Send Slack notification</span>
                </label>
                {nodeConfig.also_notify_slack === 'true' && (
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Slack Channel</label>
                    <Input
                      value={nodeConfig.slack_channel || ''}
                      onChange={(e) => setNodeConfig({ ...nodeConfig, slack_channel: e.target.value })}
                      className="mt-1 h-9"
                      placeholder="#emily-space"
                    />
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setConfigDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={saveNodeConfig}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
