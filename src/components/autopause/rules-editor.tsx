'use client';

import type { ReactNode } from 'react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ladder, rule2Line, type AutopauseSettings } from '@/lib/winners-autopause';

/** What the person is typing — strings so half-typed numbers don't jump around. */
export interface RulesDraft {
  targetCpa: string;
  cutoffPct: string;
  rule1Enabled: boolean;
  rule2Enabled: boolean;
  rule2MinTrials: string;
  rule2Window: string;
  rule3Enabled: boolean;
  minDays: string;
  maxPausesPerRun: string;
}

type NumberField = Exclude<keyof RulesDraft, 'rule1Enabled' | 'rule2Enabled' | 'rule3Enabled'>;

/** Allowed ranges — same as `sanitizeSettings` on the server. */
const RANGES: Record<NumberField, { min: number; max: number; label: string }> = {
  targetCpa: { min: 50, max: 2000, label: 'Target CPA' },
  cutoffPct: { min: 1, max: 50, label: 'Cutoff' },
  rule2MinTrials: { min: 1, max: 100, label: 'Trials before Rule 2' },
  rule2Window: { min: 500, max: 20000, label: 'Rule 2 window' },
  minDays: { min: 1, max: 14, label: 'Days before pausing' },
  maxPausesPerRun: { min: 0, max: 50, label: 'Max pauses per day' },
};

export function draftFromSettings(s: AutopauseSettings): RulesDraft {
  return {
    targetCpa: String(s.targetCpa),
    cutoffPct: String(Math.round(s.cutoff * 1000) / 10),
    rule1Enabled: s.rule1Enabled,
    rule2Enabled: s.rule2Enabled,
    rule2MinTrials: String(s.rule2MinTrials),
    rule2Window: String(s.rule2Window),
    rule3Enabled: s.rule3Enabled,
    minDays: String(s.minDays),
    maxPausesPerRun: String(s.maxPausesPerRun),
  };
}

/** Field → error message, for anything empty or out of range. */
export function validateDraft(d: RulesDraft): Partial<Record<NumberField, string>> {
  const errors: Partial<Record<NumberField, string>> = {};

  for (const key of Object.keys(RANGES) as NumberField[]) {
    const { min, max } = RANGES[key];
    const n = Number(d[key]);

    if (d[key].trim() === '' || !Number.isFinite(n)) errors[key] = 'Enter a number';
    else if (n < min || n > max) errors[key] = `${min}–${max.toLocaleString('en-US')}`;
  }

  return errors;
}

/** Turn a (valid) draft into settings to save or preview. */
export function settingsFromDraft(base: AutopauseSettings, d: RulesDraft): AutopauseSettings {
  return {
    ...base,
    targetCpa: Number(d.targetCpa),
    cutoff: Number(d.cutoffPct) / 100,
    rule1Enabled: d.rule1Enabled,
    rule2Enabled: d.rule2Enabled,
    rule2MinTrials: Math.round(Number(d.rule2MinTrials)),
    rule2Window: Number(d.rule2Window),
    rule3Enabled: d.rule3Enabled,
    minDays: Math.round(Number(d.minDays)),
    maxPausesPerRun: Math.round(Number(d.maxPausesPerRun)),
  };
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** A number box that sits inside a sentence. */
function Inline({
  value,
  onChange,
  error,
  prefix,
  suffix,
  width = 'w-20',
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  prefix?: string;
  suffix?: string;
  width?: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className="relative mx-1 inline-flex items-center align-baseline">
      {prefix && <span className="mr-0.5 text-[var(--color-muted-foreground)]">{prefix}</span>}
      <input
        aria-label={label}
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        className={cn(
          'h-8 rounded-md border bg-[var(--color-card)] px-2 text-center text-sm font-semibold text-[var(--color-foreground)] tabular-nums focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none disabled:opacity-50',
          error ? 'border-red-500' : 'border-[var(--color-input)]',
          width
        )}
      />
      {suffix && <span className="ml-1 text-[var(--color-muted-foreground)]">{suffix}</span>}
      {error && (
        <span className="absolute top-full left-0 mt-0.5 text-[11px] whitespace-nowrap text-red-500">
          {error}
        </span>
      )}
    </span>
  );
}

function RuleCard({
  number,
  title,
  enabled,
  onToggle,
  children,
  footer,
}: {
  number?: string;
  title: string;
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const off = enabled === false;

  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--color-border)] p-4 transition-opacity md:p-5',
        off && 'opacity-60'
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {number && (
            <span className="rounded-md bg-[var(--color-accent)] px-2 py-0.5 text-xs font-semibold text-[var(--color-muted-foreground)]">
              {number}
            </span>
          )}
          <h3 className="font-semibold text-[var(--color-foreground)]">{title}</h3>
        </div>
        {onToggle && (
          <label className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
            {off ? 'Off' : 'On'}
            <Switch checked={!off} onCheckedChange={onToggle} aria-label={`${title} on/off`} />
          </label>
        )}
      </div>
      <div className="text-sm leading-9 text-[var(--color-foreground)]">{children}</div>
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

/**
 * Every rule written as a sentence with the numbers you can change right in it. The ladder
 * and the Rule 2 line update live as you type, so the effect of a change is visible before
 * saving.
 */
export function RulesEditor({
  draft,
  onChange,
}: {
  draft: RulesDraft;
  onChange: (next: RulesDraft) => void;
}) {
  const errors = validateDraft(draft);
  const set = <K extends keyof RulesDraft>(key: K, value: RulesDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const valid = !errors.targetCpa && !errors.cutoffPct;
  const target = Number(draft.targetCpa);
  const cutoff = Number(draft.cutoffPct) / 100;
  const window = Number(draft.rule2Window);
  const steps = valid ? ladder({ targetCpa: target, cutoff }, 8) : [];
  const line = valid && !errors.rule2Window ? rule2Line(window, target, cutoff) : null;
  const oneIn = valid ? Math.round(1 / cutoff) : null;

  return (
    <div className="space-y-4">
      <RuleCard title="The bar every ad is held to">
        Hold ads to a
        <Inline
          label="Target CPA"
          prefix="$"
          value={draft.targetCpa}
          error={errors.targetCpa}
          onChange={(v) => set('targetCpa', v)}
        />
        CPA. Only pause when a good ad would look this bad less than
        <Inline
          label="Cutoff percent"
          suffix="%"
          width="w-16"
          value={draft.cutoffPct}
          error={errors.cutoffPct}
          onChange={(v) => set('cutoffPct', v)}
        />
        of the time{oneIn ? ` (about 1 in ${oneIn})` : ''}.
        <p className="mt-1 text-xs leading-5 text-[var(--color-muted-foreground)]">
          Lower cutoff = more patient, fewer pauses. Higher = stricter, more pauses (and more good
          ads paused by bad luck).
        </p>
      </RuleCard>

      <RuleCard
        number="Rule 1"
        title="Too few trials for what it spent"
        enabled={draft.rule1Enabled}
        onToggle={(v) => set('rule1Enabled', v)}
        footer={
          steps.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-[var(--color-muted-foreground)]">
                Spend caps with these numbers
              </p>
              <div className="flex flex-wrap gap-1.5">
                {steps.map((s) => (
                  <span
                    key={s.trials}
                    className="rounded-md bg-[var(--color-accent)] px-2 py-1 text-xs tabular-nums"
                  >
                    <span className="text-[var(--color-muted-foreground)]">
                      {s.trials} {s.trials === 1 ? 'trial' : 'trials'} →
                    </span>{' '}
                    <span className="font-semibold">{money(s.cap)}</span>
                  </span>
                ))}
              </div>
            </div>
          )
        }
      >
        Pause an ad once its total spend goes past the cap for its trial count.
      </RuleCard>

      <RuleCard
        number="Rule 2"
        title="Stopped working (fatigue)"
        enabled={draft.rule2Enabled}
        onToggle={(v) => set('rule2Enabled', v)}
      >
        Once an ad has
        <Inline
          label="Trials before Rule 2 applies"
          width="w-14"
          value={draft.rule2MinTrials}
          error={errors.rule2MinTrials}
          onChange={(v) => set('rule2MinTrials', v)}
        />
        trials, look only at its last
        <Inline
          label="Rule 2 window"
          prefix="$"
          width="w-24"
          value={draft.rule2Window}
          error={errors.rule2Window}
          onChange={(v) => set('rule2Window', v)}
        />
        of spend. Pause it if it got{' '}
        <strong className="tabular-nums">{line === null ? '—' : line}</strong> or fewer trials
        there.
        <p className="mt-1 text-xs leading-5 text-[var(--color-muted-foreground)]">
          The line ({line === null ? '—' : line}) is worked out from the target CPA and cutoff
          above, so it moves when they do.
        </p>
      </RuleCard>

      <RuleCard
        number="Rule 3"
        title="Too early to judge"
        enabled={draft.rule3Enabled}
        onToggle={(v) => set('rule3Enabled', v)}
      >
        Never pause an ad with fewer than
        <Inline
          label="Days of spend before pausing"
          width="w-14"
          value={draft.minDays}
          error={errors.minDays}
          onChange={(v) => set('minDays', v)}
        />
        days of spend.
      </RuleCard>

      <RuleCard title="Safety limit">
        If more than
        <Inline
          label="Max pauses per day"
          width="w-14"
          value={draft.maxPausesPerRun}
          error={errors.maxPausesPerRun}
          onChange={(v) => set('maxPausesPerRun', v)}
        />
        ads fail on the same day, pause none of them and warn in Slack instead. A wave of failures
        usually means bad data, not bad ads.
      </RuleCard>
    </div>
  );
}

export { RANGES as RULE_RANGES };
