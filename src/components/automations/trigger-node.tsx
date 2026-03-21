'use client';

import { Handle, Position } from 'reactflow';
import { Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface TriggerNodeProps {
  data: {
    label: string;
    config: Record<string, unknown>;
    onConfigChange?: (config: Record<string, unknown>) => void;
  };
  selected: boolean;
}

export function TriggerNode({ data, selected }: TriggerNodeProps) {
  const t = useTranslations('automations');

  return (
    <div
      className={`min-w-[220px] rounded-xl border-2 bg-[var(--color-card)] px-4 py-3 shadow-sm ${selected ? 'border-blue-500 shadow-blue-100' : 'border-amber-300'}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100">
          <Zap className="h-4 w-4 text-amber-600" />
        </div>
        <span className="text-xs font-semibold tracking-wider text-amber-700 uppercase">
          {t('trigger')}
        </span>
      </div>
      <p className="text-sm font-medium text-[var(--color-foreground)]">
        {data.label || t('selectTrigger')}
      </p>
      {data.config?.entity_type ? (
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          {String(data.config.entity_type)} •{' '}
          {data.config.schedule === 'hourly'
            ? t('scheduleLabels.hourly')
            : t('scheduleLabels.15min')}
        </p>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-3 !w-3 !border-2 !border-white !bg-amber-500"
      />
    </div>
  );
}
