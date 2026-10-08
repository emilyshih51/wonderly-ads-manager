'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, History, Play, RefreshCw, RotateCcw, Send } from 'lucide-react';

import { ModeControl, type AutopauseMode } from '@/components/autopause/mode-control';
import { DECISION_LABEL, ResultsTable } from '@/components/autopause/results-table';
import {
  RulesEditor,
  draftFromSettings,
  settingsFromDraft,
  validateDraft,
  type RulesDraft,
} from '@/components/autopause/rules-editor';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, apiPut } from '@/lib/queries/api-fetch';
import { cn } from '@/lib/utils';
import {
  DEFAULT_AUTOPAUSE_SETTINGS,
  planRun,
  type AutopauseDecision,
  type AutopauseSettings,
} from '@/lib/winners-autopause';
import type { SettingsChange, StoredRun } from '@/lib/winners-autopause-runner';

interface AutopauseState {
  settings: AutopauseSettings;
  persisted: boolean;
  envKillSwitch: boolean;
  runs: StoredRun[];
  changes: SettingsChange[];
}

const QUERY_KEY = ['winners-autopause'];

type Filter = 'ALL' | AutopauseDecision;

const TILES: Array<{ key: AutopauseDecision; label: string; tone: string; ring: string }> = [
  {
    key: 'PAUSE',
    label: 'Pause',
    tone: 'text-red-600 dark:text-red-400',
    ring: 'ring-red-500',
  },
  {
    key: 'WATCH',
    label: 'Watch',
    tone: 'text-amber-600 dark:text-amber-400',
    ring: 'ring-amber-500',
  },
  {
    key: 'OK',
    label: 'OK',
    tone: 'text-emerald-600 dark:text-emerald-400',
    ring: 'ring-emerald-500',
  },
  {
    key: 'TOO_EARLY',
    label: 'Too early',
    tone: 'text-[var(--color-muted-foreground)]',
    ring: 'ring-slate-400',
  },
];

const FIELD_LABELS: Partial<Record<keyof AutopauseSettings, string>> = {
  enabled: 'Auto-pause on',
  dryRun: 'Dry run',
  targetCpa: 'Target CPA',
  cutoff: 'Cutoff',
  rule1Enabled: 'Rule 1',
  rule2Enabled: 'Rule 2',
  rule3Enabled: 'Rule 3',
  rule2Window: 'Rule 2 window',
  rule2MinTrials: 'Trials before Rule 2',
  minDays: 'Days before pausing',
  maxPausesPerRun: 'Max pauses per day',
};

function formatValue(key: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (key === 'cutoff' && typeof v === 'number') return `${Math.round(v * 1000) / 10}%`;

  if ((key === 'targetCpa' || key === 'rule2Window') && typeof v === 'number') {
    return `$${v.toLocaleString('en-US')}`;
  }

  return String(v);
}

function modeOf(s: AutopauseSettings): AutopauseMode {
  if (!s.enabled) return 'off';

  return s.dryRun ? 'dry' : 'live';
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export default function AutopausePage() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<AutopauseState>('/api/winners-autopause'),
  });

  const [draft, setDraft] = useState<RulesDraft | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  const save = useMutation({
    mutationFn: (patch: Partial<AutopauseSettings>) =>
      apiPut<{ settings: AutopauseSettings }>('/api/winners-autopause', patch),
    onSuccess: () => void refresh(),
  });
  const runNow = useMutation({
    mutationFn: () => apiFetch<{ run: StoredRun }>('/api/winners-autopause', { method: 'POST' }),
    onSuccess: () => {
      sendSlack.reset();
      void refresh();
    },
  });
  const sendSlack = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>('/api/winners-autopause/slack', { method: 'POST' }),
  });

  const settings = data?.settings;
  const latest = data?.runs?.[0];
  const savedDraft = settings ? draftFromSettings(settings) : null;
  const current = draft ?? savedDraft;
  const errors = current ? validateDraft(current) : {};
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = !!draft && !!savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft);

  // With unsaved rule changes, re-run the rules on the latest check's data right here, so you
  // see what the new numbers would do before saving. No Meta calls.
  const preview = useMemo(() => {
    if (!dirty || hasErrors || !settings || !current || !latest?.inputs) return null;

    return planRun(latest.inputs, settingsFromDraft(settings, current));
  }, [dirty, hasErrors, settings, current, latest]);

  const shown = preview?.evaluations ?? latest?.evaluations ?? [];
  const before = preview
    ? new Map(latest?.evaluations.map((e) => [e.adId, e.decision] as const))
    : undefined;
  const count = (d: AutopauseDecision) => shown.filter((e) => e.decision === d).length;
  const savedCount = (d: AutopauseDecision) =>
    latest?.evaluations.filter((e) => e.decision === d).length ?? 0;
  const filtered = filter === 'ALL' ? shown : shown.filter((e) => e.decision === filter);

  const mode = settings ? modeOf(settings) : 'off';
  const setMode = (m: AutopauseMode) =>
    save.mutate(m === 'off' ? { enabled: false } : { enabled: true, dryRun: m === 'dry' });

  const lockedReason = data?.envKillSwitch
    ? 'Stopped by WINNERS_AUTOPAUSE_DISABLED in Vercel. Remove it to use these controls.'
    : data && !data.persisted
      ? "Redis isn't connected, so changes can't be saved and every run is a dry run."
      : undefined;

  return (
    <div>
      <Header
        title="Winners Auto-pause"
        showDatePreset={false}
        description="Checks every Winners ad once a day and pauses the ones that fail the rules."
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendSlack.mutate()}
            disabled={sendSlack.isPending || !latest}
            title="Post the latest check to Slack"
          >
            {sendSlack.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {sendSlack.isSuccess ? 'Sent' : 'Send to Slack'}
          </Button>
          <Button
            size="sm"
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending || !settings}
          >
            {runNow.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {runNow.isPending ? 'Checking…' : 'Run check now'}
          </Button>
        </div>
      </Header>

      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        {error && (
          <p className="text-sm text-red-500">Couldn&apos;t load: {(error as Error).message}</p>
        )}

        {/* 1. Mode */}
        <Card>
          <CardContent className="p-5 md:p-6">
            {isLoading || !settings ? (
              <Skeleton className="h-14 w-full" />
            ) : (
              <ModeControl
                mode={mode}
                onChange={setMode}
                disabled={save.isPending || !!lockedReason}
                lockedReason={lockedReason}
              />
            )}
          </CardContent>
        </Card>

        {/* 2. Latest check */}
        <Card>
          <CardContent className="p-5 md:p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
                {preview ? 'Preview with your unsaved changes' : 'Latest check'}
              </h2>
              {latest && (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Data through {latest.throughDate} ·{' '}
                  {latest.trigger === 'preview' ? 'run by hand' : 'daily run'} {when(latest.ranAt)}
                  {latest.settings.dryRun ? ' · dry run' : ''}
                  {latest.paused.length > 0 ? ` · ${latest.paused.length} paused` : ''}
                </p>
              )}
            </div>

            {runNow.error && (
              <p className="mb-3 rounded-md bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
                {(runNow.error as Error).message}
              </p>
            )}
            {sendSlack.error && (
              <p className="mb-3 rounded-md bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
                {(sendSlack.error as Error).message}
              </p>
            )}
            {dirty && !preview && !hasErrors && latest && !latest.inputs && (
              <p className="mb-3 rounded-md bg-[var(--color-accent)] p-3 text-sm text-[var(--color-muted-foreground)]">
                Click “Run check now” once to enable live previews of rule changes.
              </p>
            )}
            {latest?.overLimit && !preview && (
              <p className="mb-3 rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                {savedCount('PAUSE')} ads failed, more than the safety limit of{' '}
                {latest.settings.maxPausesPerRun}. Nothing was paused — check the data.
              </p>
            )}
            {latest?.note && !preview && (
              <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">{latest.note}</p>
            )}

            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !latest ? (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] py-10 text-center">
                <p className="text-sm text-[var(--color-muted-foreground)]">No checks yet.</p>
                <Button
                  className="mt-3"
                  size="sm"
                  onClick={() => runNow.mutate()}
                  disabled={runNow.isPending}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Run the first check
                </Button>
              </div>
            ) : (
              <>
                {/* Summary tiles double as filters */}
                <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                  {TILES.map((t) => {
                    const active = filter === t.key;
                    const n = count(t.key);
                    const was = savedCount(t.key);

                    return (
                      <button
                        key={t.key}
                        onClick={() => setFilter(active ? 'ALL' : t.key)}
                        aria-pressed={active}
                        className={cn(
                          'rounded-xl border border-[var(--color-border)] p-3 text-left transition hover:bg-[var(--color-accent)] md:p-4',
                          active && `ring-2 ${t.ring}`
                        )}
                      >
                        <p className="text-xs font-medium text-[var(--color-muted-foreground)]">
                          {t.key === 'PAUSE' && (latest.settings.dryRun || preview)
                            ? 'Would pause'
                            : t.label}
                        </p>
                        <p className={cn('mt-1 text-2xl font-bold tabular-nums', t.tone)}>
                          {n}
                          {preview && n !== was && (
                            <span className="ml-2 text-xs font-normal text-[var(--color-muted-foreground)]">
                              was {was}
                            </span>
                          )}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {filter !== 'ALL' && (
                  <p className="mb-2 text-xs text-[var(--color-muted-foreground)]">
                    Showing {DECISION_LABEL[filter]} only ·{' '}
                    <button className="underline" onClick={() => setFilter('ALL')}>
                      show all
                    </button>
                  </p>
                )}

                <ResultsTable evaluations={filtered} before={before} />
              </>
            )}
          </CardContent>
        </Card>

        {/* 3. Rules */}
        <Card>
          <CardContent className="p-5 md:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Rules</h2>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Change any number below. The check above updates to show what your changes would
                  do before you save.
                </p>
              </div>
              {settings && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft(draftFromSettings({ ...settings, ...defaultsOnly() }))}
                  title="Set every rule back to the numbers in the spec"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset to spec
                </Button>
              )}
            </div>

            {current ? (
              <RulesEditor draft={current} onChange={setDraft} />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </CardContent>
        </Card>

        {/* 4. Change history */}
        {data?.changes && data.changes.length > 0 && (
          <Card>
            <CardContent className="p-5 md:p-6">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-[var(--color-foreground)]">
                <History className="h-4 w-4" />
                Change history
              </h2>
              <ul className="space-y-2 text-sm">
                {data.changes.map((c) => (
                  <li key={c.at} className="flex flex-wrap gap-x-2">
                    <span className="text-[var(--color-muted-foreground)] tabular-nums">
                      {when(c.at)}
                    </span>
                    <span className="font-medium">{c.by}</span>
                    <span className="text-[var(--color-muted-foreground)]">
                      {Object.entries(c.changes)
                        .map(
                          ([k, [a, b]]) =>
                            `${FIELD_LABELS[k as keyof AutopauseSettings] ?? k} ${formatValue(k, a)} → ${formatValue(k, b)}`
                        )
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Save bar — only when there are unsaved rule changes */}
      {dirty && (
        <div className="sticky bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-card)]/95 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
            <p className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
              <Eye className="h-4 w-4 text-[var(--color-primary)]" />
              {hasErrors
                ? 'Fix the highlighted numbers to preview and save.'
                : preview
                  ? `Unsaved changes: would pause ${preview.evaluations.filter((e) => e.decision === 'PAUSE').length} (now ${savedCount('PAUSE')}).`
                  : 'You have unsaved changes.'}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
                Discard
              </Button>
              <Button
                size="sm"
                disabled={hasErrors || save.isPending || !!lockedReason}
                onClick={() =>
                  settings &&
                  current &&
                  save.mutate(settingsFromDraft(settings, current), {
                    onSuccess: () => setDraft(null),
                  })
                }
              >
                {save.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
          {save.error && (
            <p className="px-4 pb-2 text-center text-xs text-red-500">
              {(save.error as Error).message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The rule numbers from the spec (not the on/off or dry-run state). */
function defaultsOnly(): Partial<AutopauseSettings> {
  const { enabled: _e, dryRun: _d, campaignId: _c, ...rules } = DEFAULT_AUTOPAUSE_SETTINGS;

  return rules;
}
