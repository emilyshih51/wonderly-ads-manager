'use client';

import { Handle, Position } from 'reactflow';
import { Zap } from 'lucide-react';

interface TriggerNodeProps {
  data: {
    label: string;
    config: Record<string, unknown>;
    onConfigChange?: (config: Record<string, unknown>) => void;
  };
  selected: boolean;
}

export function TriggerNode({ data, selected }: TriggerNodeProps) {
  return (
    <div className={`px-4 py-3 rounded-xl border-2 bg-white shadow-sm min-w-[220px] ${selected ? 'border-blue-500 shadow-blue-100' : 'border-amber-300'}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100">
          <Zap className="h-4 w-4 text-amber-600" />
        </div>
        <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Trigger</span>
      </div>
      <p className="text-sm font-medium text-gray-900">{data.label || 'Select trigger...'}</p>
      {data.config?.entity_type ? (
        <p className="text-xs text-gray-500 mt-1">
          {String(data.config.entity_type)} • {data.config.schedule === 'hourly' ? 'Every hour' : 'Every 15 min'}
        </p>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!bg-amber-500 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}
