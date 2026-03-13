'use client';

import { Handle, Position } from 'reactflow';
import { GitBranch } from 'lucide-react';

interface ConditionNodeProps {
  data: {
    label: string;
    config: Record<string, unknown>;
  };
  selected: boolean;
}

export function ConditionNode({ data, selected }: ConditionNodeProps) {
  return (
    <div className={`px-4 py-3 rounded-xl border-2 bg-white shadow-sm min-w-[220px] ${selected ? 'border-blue-500 shadow-blue-100' : 'border-purple-300'}`}>
      <Handle type="target" position={Position.Top} className="!bg-purple-500 !w-3 !h-3 !border-2 !border-white" />
      <div className="flex items-center gap-2 mb-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100">
          <GitBranch className="h-4 w-4 text-purple-600" />
        </div>
        <span className="text-xs font-semibold text-purple-700 uppercase tracking-wider">Condition</span>
      </div>
      <p className="text-sm font-medium text-gray-900">{data.label || 'Set condition...'}</p>
      {data.config?.metric ? (
        <p className="text-xs text-gray-500 mt-1">
          If {String(data.config.metric)} {String(data.config.operator)} ${String(data.config.threshold)}
        </p>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}
