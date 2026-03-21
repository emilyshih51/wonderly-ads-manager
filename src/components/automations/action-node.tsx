'use client';

import { Handle, Position } from 'reactflow';
import { Play } from 'lucide-react';

interface ActionNodeProps {
  data: {
    label: string;
    config: Record<string, unknown>;
  };
  selected: boolean;
}

export function ActionNode({ data, selected }: ActionNodeProps) {
  return (
    <div
      className={`min-w-[220px] rounded-xl border-2 bg-[var(--color-card)] px-4 py-3 shadow-sm ${selected ? 'border-blue-500 shadow-blue-100' : 'border-emerald-300'}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !border-2 !border-white !bg-emerald-500"
      />
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100">
          <Play className="h-4 w-4 text-emerald-600" />
        </div>
        <span className="text-xs font-semibold tracking-wider text-emerald-700 uppercase">
          Action
        </span>
      </div>
      <p className="text-sm font-medium text-[var(--color-foreground)]">
        {data.label || 'Select action...'}
      </p>
      {data.config?.action_type ? (
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          {data.config.action_type === 'pause'
            ? 'Pause ad/ad set'
            : data.config.action_type === 'activate'
              ? 'Activate ad/ad set'
              : data.config.action_type === 'slack_notify'
                ? 'Send Slack notification'
                : String(data.config.action_type)}
          {data.config.also_notify_slack ? ' + Slack' : ''}
        </p>
      ) : null}
    </div>
  );
}
