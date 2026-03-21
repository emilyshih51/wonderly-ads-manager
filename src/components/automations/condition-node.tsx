'use client';

import { Handle, Position } from 'reactflow';
import { GitBranch } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface ConditionNodeProps {
  data: {
    label: string;
    config: Record<string, unknown>;
  };
  selected: boolean;
}

export function ConditionNode({ data, selected }: ConditionNodeProps) {
  const t = useTranslations('automations');

  return (
    <div
      className={`min-w-[220px] rounded-xl border-2 bg-[var(--color-card)] px-4 py-3 shadow-sm ${selected ? 'border-blue-500 shadow-blue-100' : 'border-purple-300'}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !border-2 !border-white !bg-purple-500"
      />
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100">
          <GitBranch className="h-4 w-4 text-purple-600" />
        </div>
        <span className="text-xs font-semibold tracking-wider text-purple-700 uppercase">
          {t('condition')}
        </span>
      </div>
      <p className="text-sm font-medium text-[var(--color-foreground)]">
        {data.label || t('setCondition')}
      </p>
      {data.config?.metric ? (
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          If {String(data.config.metric)} {String(data.config.operator)} $
          {String(data.config.threshold)}
        </p>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-3 !w-3 !border-2 !border-white !bg-purple-500"
      />
    </div>
  );
}
