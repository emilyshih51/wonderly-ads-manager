'use client';

import { Handle, Position } from 'reactflow';
import { Play } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface ActionNodeProps {
  data: {
    label: string;
    config: Record<string, unknown>;
  };
  selected: boolean;
}

export function ActionNode({ data, selected }: ActionNodeProps) {
  const t = useTranslations('automations');

  let actionTypeLabel: string | undefined;
  if (data.config?.action_type === 'adjust_budget') {
    const dir = data.config.adjust_direction as string | undefined;
    const amtType = data.config.adjust_amount_type as string | undefined;
    const amt = data.config.adjust_amount as number | undefined;
    const dirLabel = dir === 'increase' ? t('increaseBudgetBy') : t('decreaseBudgetBy');
    const amtLabel = amt !== undefined ? (amtType === 'percent' ? `${amt}%` : `$${amt}`) : '';
    actionTypeLabel = `${dirLabel}${amtLabel ? ' ' + amtLabel : ''}`;
  }

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
          {t('action')}
        </span>
      </div>
      <p className="text-sm font-medium text-[var(--color-foreground)]">
        {data.label || t('selectAction')}
      </p>
      {data.config?.action_type ? (
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          {data.config.action_type === 'pause'
            ? t('pauseAdAdSet')
            : data.config.action_type === 'activate'
              ? t('activateAdAdSet')
              : data.config.action_type === 'slack_notify'
                ? t('sendSlackNotification')
                : actionTypeLabel ?? String(data.config.action_type)}
          {data.config.also_notify_slack ? ' ' + t('plusSlack') : ''}
        </p>
      ) : null}
    </div>
  );
}
