'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type AutopauseMode = 'off' | 'dry' | 'live';

const MODES: Array<{ value: AutopauseMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'dry', label: 'Dry run' },
  { value: 'live', label: 'Live' },
];

const COPY: Record<AutopauseMode, { title: string; body: string; dot: string }> = {
  off: {
    title: 'Off',
    body: 'The daily check is stopped. Nothing is checked, posted, or paused.',
    dot: 'bg-slate-400',
  },
  dry: {
    title: 'Dry run',
    body: 'Checks every day and posts what it would pause in Slack. Never pauses anything.',
    dot: 'bg-amber-500',
  },
  live: {
    title: 'Live',
    body: 'Checks every day and pauses ads that fail the rules. Posts what it did in Slack.',
    dot: 'bg-emerald-500',
  },
};

/** Next daily run (15:00 UTC = 8am PT), formatted in Pacific time. */
export function nextRunLabel(now = new Date()): string {
  const next = new Date(now);

  next.setUTCHours(15, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(next);

  return `${day}, 8:00 AM PT`;
}

/**
 * The one control that matters most: is the bot off, checking only, or pausing for real?
 * Going Live asks for confirmation; going Off or Dry run is instant (they're the safe way).
 */
export function ModeControl({
  mode,
  onChange,
  disabled,
  lockedReason,
}: {
  mode: AutopauseMode;
  onChange: (mode: AutopauseMode) => void;
  disabled?: boolean;
  lockedReason?: string;
}) {
  const [confirmLive, setConfirmLive] = useState(false);
  const copy = COPY[mode];

  const pick = (value: AutopauseMode) => {
    if (value === mode) return;
    if (value === 'live') setConfirmLive(true);
    else onChange(value);
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <span className={cn('mt-2 h-3 w-3 shrink-0 rounded-full', copy.dot)} />
        <div>
          <p className="text-lg font-semibold text-[var(--color-foreground)]">{copy.title}</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">{copy.body}</p>
          {mode !== 'off' && !lockedReason && (
            <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
              Next check: {nextRunLabel()}, on yesterday&apos;s completed data
            </p>
          )}
          {lockedReason && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {lockedReason}
            </p>
          )}
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="Auto-pause mode"
        className="inline-flex shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-1"
      >
        {MODES.map((m) => {
          const active = m.value === mode;

          return (
            <button
              key={m.value}
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => pick(m.value)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                active
                  ? m.value === 'live'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : m.value === 'dry'
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-[var(--color-card)] text-[var(--color-foreground)] shadow-sm'
                  : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <Dialog open={confirmLive} onOpenChange={setConfirmLive}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn on live pausing?</DialogTitle>
            <DialogDescription>
              From the next daily check, the bot will actually pause Winners ads that fail the
              rules, and post what it paused in Slack. It never turns ads back on or changes
              budgets. You can switch back to Dry run or Off at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmLive(false)}>
              Cancel
            </Button>
            <Button
              variant="success"
              onClick={() => {
                setConfirmLive(false);
                onChange('live');
              }}
            >
              Yes, go live
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
