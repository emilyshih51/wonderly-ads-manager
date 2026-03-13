'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { TriggerNode } from '@/components/automations/trigger-node';
import { ConditionNode } from '@/components/automations/condition-node';
import { ActionNode } from '@/components/automations/action-node';
import {
  Plus, Save, Trash2, Zap, GitBranch, Play,
  Power, PowerOff, LayoutList, Workflow, ChevronRight,
  Clock, Activity, Pause, Bell, Edit3,
} from 'lucide-react';

const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
};

interface Rule {
  id: string;
  name: string;
  is_active: boolean;
  nodes: Node[];
  edges: Edge[];
}

const defaultNodes: Node[] = [
  {
    id: 'trigger-1', type: 'trigger', position: { x: 250, y: 50 },
    data: { label: 'Check Ad Performance', config: { entity_type: 'adset', schedule: 'hourly' } },
  },
  {
    id: 'condition-1', type: 'condition', position: { x: 250, y: 200 },
    data: { label: 'Spend Threshold', config: { metric: 'spend', operator: '>', threshold: '50' } },
  },
  {
    id: 'action-1', type: 'action', position: { x: 250, y: 350 },
    data: { label: 'Pause & Notify', config: { action_type: 'pause', also_notify_slack: 'true' } },
  },
];

const defaultEdges: Edge[] = [
  { id: 'e-trigger-condition', source: 'trigger-1', target: 'condition-1', animated: true, style: { stroke: '#a78bfa' } },
  { id: 'e-condition-action', source: 'condition-1', target: 'action-1', animated: true, style: { stroke: '#34d399' } },
];

const SCHEDULE_OPTIONS = [
  { label: 'Every minute', value: '1min' },
  { label: 'Every 5 minutes', value: '5min' },
  { label: 'Every 15 minutes', value: '15min' },
  { label: 'Every hour', value: 'hourly' },
  { label: 'Every 6 hours', value: '6hours' },
  { label: 'Daily', value: 'daily' },
];

const SCHEDULE_LABELS: Record<string, string> = {
  '1min': 'Every minute',
  '5min': 'Every 5 min',
  '15min': 'Every 15 min',
  'hourly': 'Every hour',
  '6hours': 'Every 6 hours',
  'daily': 'Daily',
};

const ACTION_LABELS: Record<string, string> = {
  pause: 'Pause entity',
  activate: 'Activate entity',
  slack_notify: 'Slack notification',
};

const METRIC_LABELS: Record<string, string> = {
  spend: 'Spend', impressions: 'Impressions', clicks: 'Clicks',
  ctr: 'CTR', cpc: 'CPC', cpm: 'CPM',
};

export default function AutomationsPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);
  const [rules, setRules] = useState<Rule[]>([]);
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [ruleName, setRuleName] = useState('New Automation');
  const [saving, setSaving] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [nodeConfig, setNodeConfig] = useState<Record<string, string>>({});

  /* -- View mode: 'rules' (list) or 'canvas' (builder) -- */
  const [viewMode, setViewMode] = useState<'rules' | 'canvas'>('rules');

  const memoizedNodeTypes = useMemo(() => nodeTypes, []);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#a78bfa' } }, eds)),
    [setEdges]
  );

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
        is_active: selectedRule?.is_active ?? true,
        nodes, edges,
      };
      await fetch('/api/automations/rules', {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      fetchRules();
    } catch (err) { console.error('Save failed:', err); }
    finally { setSaving(false); }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      await fetch(`/api/automations/rules?id=${ruleId}`, { method: 'DELETE' });
      fetchRules();
      if (selectedRule?.id === ruleId) {
        setSelectedRule(null);
        setNodes(defaultNodes); setEdges(defaultEdges);
        setRuleName('New Automation');
      }
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

  const loadRule = (rule: Rule) => {
    setSelectedRule(rule);
    setRuleName(rule.name);
    setNodes(rule.nodes); setEdges(rule.edges);
  };

  const editRule = (rule: Rule) => {
    loadRule(rule);
    setViewMode('canvas');
  };

  const newAutomation = () => {
    setSelectedRule(null);
    setNodes(defaultNodes); setEdges(defaultEdges);
    setRuleName('New Automation');
    setViewMode('canvas');
  };

  const addNode = (type: 'trigger' | 'condition' | 'action') => {
    const id = `${type}-${Date.now()}`;
    const labels: Record<string, string> = { trigger: 'New Trigger', condition: 'New Condition', action: 'New Action' };
    const newNode: Node = {
      id, type, position: { x: 250, y: (nodes.length + 1) * 150 },
      data: { label: labels[type], config: {} },
    };
    setNodes((nds) => [...nds, newNode]);
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

  /* Helper: extract info from rule nodes */
  const getRuleInfo = (rule: Rule) => {
    const trigger = rule.nodes.find((n) => n.type === 'trigger');
    const condition = rule.nodes.find((n) => n.type === 'condition');
    const action = rule.nodes.find((n) => n.type === 'action');
    return {
      entityType: trigger?.data?.config?.entity_type || 'N/A',
      schedule: trigger?.data?.config?.schedule || 'hourly',
      metric: condition?.data?.config?.metric || 'N/A',
      operator: condition?.data?.config?.operator || '>',
      threshold: condition?.data?.config?.threshold || '0',
      actionType: action?.data?.config?.action_type || 'N/A',
      triggerLabel: trigger?.data?.label || 'Trigger',
      conditionLabel: condition?.data?.label || 'Condition',
      actionLabel: action?.data?.label || 'Action',
    };
  };

  return (
    <div className="flex flex-col h-screen">
      <Header title="Automations" description="Set up rules to auto-manage your ads">
        <div className="flex items-center gap-2">
          {/* View mode tabs */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('rules')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'rules' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <LayoutList className="h-3.5 w-3.5" /> Rules
            </button>
            <button
              onClick={() => setViewMode('canvas')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'canvas' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Workflow className="h-3.5 w-3.5" /> Canvas Builder
            </button>
          </div>
          <Button size="sm" onClick={newAutomation}>
            <Plus className="h-4 w-4 mr-1" /> New Automation
          </Button>
        </div>
      </Header>

      {/* ===== RULES LIST VIEW ===== */}
      {viewMode === 'rules' && (
        <div className="flex-1 overflow-y-auto p-8">
          {rules.length === 0 ? (
            <div className="text-center py-20">
              <Workflow className="h-16 w-16 text-gray-200 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No automations yet</h3>
              <p className="text-gray-500 mb-6 max-w-md mx-auto">
                Create your first automation rule to automatically monitor and manage your ad performance.
              </p>
              <Button onClick={newAutomation}>
                <Plus className="h-4 w-4 mr-2" /> Create Automation
              </Button>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              {rules.map((rule) => {
                const info = getRuleInfo(rule);
                return (
                  <Card key={rule.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-0">
                      <div className="flex items-stretch">
                        {/* Left: Status indicator */}
                        <div className={`w-1.5 rounded-l-xl flex-shrink-0 ${rule.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`} />

                        <div className="flex-1 p-5">
                          {/* Header row */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <h3 className="text-base font-semibold text-gray-900">{rule.name}</h3>
                              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                                rule.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                              }`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${rule.is_active ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                {rule.is_active ? 'Active' : 'Paused'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button variant="ghost" size="sm" onClick={() => editRule(rule)} className="text-gray-500 hover:text-blue-600">
                                <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8"
                                onClick={() => handleToggle(rule)}
                              >
                                {rule.is_active
                                  ? <Pause className="h-3.5 w-3.5 text-amber-500" />
                                  : <Play className="h-3.5 w-3.5 text-emerald-500" />
                                }
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(rule.id)}>
                                <Trash2 className="h-3.5 w-3.5 text-red-400" />
                              </Button>
                            </div>
                          </div>

                          {/* Visual flow: Trigger → Condition → Action */}
                          <div className="flex items-center gap-2 mb-3">
                            {/* Trigger chip */}
                            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              <Zap className="h-3.5 w-3.5 text-amber-600" />
                              <div>
                                <p className="text-xs font-medium text-amber-800">{info.triggerLabel}</p>
                                <p className="text-[10px] text-amber-600">{info.entityType} • {SCHEDULE_LABELS[info.schedule] || info.schedule}</p>
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
                            {/* Condition chip */}
                            <div className="flex items-center gap-1.5 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
                              <GitBranch className="h-3.5 w-3.5 text-purple-600" />
                              <div>
                                <p className="text-xs font-medium text-purple-800">{info.conditionLabel}</p>
                                <p className="text-[10px] text-purple-600">{METRIC_LABELS[info.metric] || info.metric} {info.operator} {info.threshold}</p>
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
                            {/* Action chip */}
                            <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                              <Play className="h-3.5 w-3.5 text-emerald-600" />
                              <div>
                                <p className="text-xs font-medium text-emerald-800">{info.actionLabel}</p>
                                <p className="text-[10px] text-emerald-600">{ACTION_LABELS[info.actionType] || info.actionType}</p>
                              </div>
                            </div>
                          </div>

                          {/* Meta info */}
                          <div className="flex items-center gap-4 text-xs text-gray-400">
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {SCHEDULE_LABELS[info.schedule] || info.schedule}</span>
                            <span className="flex items-center gap-1"><Activity className="h-3 w-3" /> {rule.nodes.length} nodes</span>
                            {info.actionType !== 'slack_notify' && (
                              <span className="flex items-center gap-1"><Bell className="h-3 w-3" /> +Slack notify</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===== CANVAS BUILDER VIEW ===== */}
      {viewMode === 'canvas' && (
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={memoizedNodeTypes}
            fitView
            className="bg-gray-50"
          >
            <Background color="#e5e7eb" gap={20} />
            <Controls className="!rounded-lg !border-gray-200 !shadow-sm" />
            <MiniMap className="!rounded-lg !border-gray-200" />

            <Panel position="top-center" className="flex items-center gap-3 bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-2">
              <Input
                value={ruleName} onChange={(e) => setRuleName(e.target.value)}
                className="w-64 h-8 text-sm" placeholder="Automation name..."
              />
              <Button size="sm" variant="outline" onClick={handleSave} disabled={saving}>
                <Save className="h-3.5 w-3.5 mr-1" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setViewMode('rules')}>
                Back to Rules
              </Button>
            </Panel>

            <Panel position="top-right" className="flex flex-col gap-2 bg-white rounded-xl shadow-sm border border-gray-200 p-3">
              <p className="text-xs font-medium text-gray-500 uppercase">Add Node</p>
              <Button size="sm" variant="outline" onClick={() => addNode('trigger')} className="justify-start">
                <Zap className="h-3.5 w-3.5 mr-2 text-amber-500" /> Trigger
              </Button>
              <Button size="sm" variant="outline" onClick={() => addNode('condition')} className="justify-start">
                <GitBranch className="h-3.5 w-3.5 mr-2 text-purple-500" /> Condition
              </Button>
              <Button size="sm" variant="outline" onClick={() => addNode('action')} className="justify-start">
                <Play className="h-3.5 w-3.5 mr-2 text-emerald-500" /> Action
              </Button>
            </Panel>
          </ReactFlow>
        </div>
      )}

      {/* Node Config Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure {selectedNode?.type}</DialogTitle>
            <DialogDescription>Double-click any node to edit its configuration.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {selectedNode?.type === 'trigger' && (
              <>
                <div>
                  <label className="text-sm font-medium text-gray-700">Entity Type</label>
                  <SelectNative
                    value={nodeConfig.entity_type || ''}
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
                  <label className="text-sm font-medium text-gray-700">Entity ID</label>
                  <Input
                    value={nodeConfig.entity_id || ''}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, entity_id: e.target.value })}
                    className="mt-1" placeholder="Paste campaign/ad set/ad ID"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Check Frequency</label>
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
                  <label className="text-sm font-medium text-gray-700">Metric</label>
                  <SelectNative
                    value={nodeConfig.metric || ''}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, metric: e.target.value })}
                    options={[
                      { label: 'Spend', value: 'spend' },
                      { label: 'Impressions', value: 'impressions' },
                      { label: 'Clicks', value: 'clicks' },
                      { label: 'CTR', value: 'ctr' },
                      { label: 'CPC', value: 'cpc' },
                      { label: 'CPM', value: 'cpm' },
                    ]}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Operator</label>
                  <SelectNative
                    value={nodeConfig.operator || '>'}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, operator: e.target.value })}
                    options={[
                      { label: 'Greater than (>)', value: '>' },
                      { label: 'Less than (<)', value: '<' },
                      { label: 'Greater or equal (>=)', value: '>=' },
                      { label: 'Less or equal (<=)', value: '<=' },
                      { label: 'Equals (==)', value: '==' },
                    ]}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Threshold</label>
                  <Input
                    type="number" value={nodeConfig.threshold || ''}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, threshold: e.target.value })}
                    className="mt-1" placeholder="50"
                  />
                </div>
              </>
            )}

            {selectedNode?.type === 'action' && (
              <>
                <div>
                  <label className="text-sm font-medium text-gray-700">Action</label>
                  <SelectNative
                    value={nodeConfig.action_type || ''}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, action_type: e.target.value })}
                    options={[
                      { label: 'Pause ad/ad set/campaign', value: 'pause' },
                      { label: 'Activate ad/ad set/campaign', value: 'activate' },
                      { label: 'Send Slack notification only', value: 'slack_notify' },
                    ]}
                    className="mt-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox" id="also_slack"
                    checked={nodeConfig.also_notify_slack === 'true'}
                    onChange={(e) => setNodeConfig({ ...nodeConfig, also_notify_slack: String(e.target.checked) })}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="also_slack" className="text-sm text-gray-700">Also send Slack notification</label>
                </div>
              </>
            )}

            <div>
              <label className="text-sm font-medium text-gray-700">Label</label>
              <Input
                value={selectedNode?.data?.label || ''}
                onChange={(e) => {
                  if (selectedNode) {
                    setNodes((nds) =>
                      nds.map((n) =>
                        n.id === selectedNode.id ? { ...n, data: { ...n.data, label: e.target.value } } : n
                      )
                    );
                  }
                }}
                className="mt-1"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setConfigDialogOpen(false)}>Cancel</Button>
              <Button onClick={saveNodeConfig}>Save Configuration</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
