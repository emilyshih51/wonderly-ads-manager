'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OctagonX, Play, RefreshCw, Send } from 'lucide-react';

import { Header } from '@/components/layout/header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { buildAdsManagerAdLink } from '@/lib/ads-manager-link';
import { WONDERLY_AD_ACCOUNT_ID, WONDERLY_BUSINESS_ID } from '@/lib/growth-config';
import { apiFetch, apiPut } from '@/lib/queries/api-fetch';
import { cn } from '@/lib/utils';
import type { AdEvaluation, AutopauseDecision, AutopauseSettings } from '@/lib/winners-autopause';
import type { StoredRun } from '@/lib/winners-autopause-runner';

interface AutopauseState {
  settings: AutopauseSettings;
  persisted: boolean;
  envKillSwitch: boolean;
  runs: StoredRun[];
}

const QUERY_KEY = ['winners-autopause'];

const money = (n: number | null) =>
  n === null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;

const DECISION_LABEL: Record<AutopauseDecision, string> = {
  PAUSE: 'Pause',
  WATCH: 'Watch',
  OK: 'OK',
  TOO_EARLY: 'Too early',
};

const DECISION_VARIANT: Record<AutopauseDecision, 'deleted' | 'paused' | 'active' | 'secondary'> = {
  PAUSE: 'deleted',
  WATCH: 'paused',
  OK: 'active',
  TOO_EARLY: 'secondary',
};

function SettingField({
  label,
  hint,
  value,
  onChange,
  prefix,
  suffix,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[var(--color-foreground)]">{label}</span>
      <div className="mt-1 flex items-center gap-1.5">
        {prefix && <span className="text-sm text-[var(--color-muted-foreground)]">{prefix}</span>}
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9"
        />
        {suffix && <span className="text-sm text-[var(--color-muted-foreground)]">{suffix}</span>}
      </div>
      <span className="mt-1 block text-xs text-[var(--color-muted-foreground)]">{hint}</span>
    </label>
  );
}

export default function AutopausePage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<AutopauseState>('/api/winners-autopause'),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<AutopauseSettings>) =>
      apiPut<{ settings: AutopauseSettings }>('/api/winners-autopause', patch),
    onSuccess: () => {
      setEdits({});
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const runNow = useMutation({
    mutationFn: () => apiFetch<{ run: StoredRun }>('/api/winners-autopause', { method: 'POST' }),
    onSuccess: () => {
      sendSlack.reset();
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const sendSlack = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>('/api/winners-autopause/slack', { method: 'POST' }),
  });

  const settings = data?.settings;
  // Edits the person has typed but not saved yet; anything untouched shows the saved value.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const saved: Record<string, string> = settings
    ? {
        targetCpa: String(settings.targetCpa),
        cutoff: String(Math.round(settings.cutoff * 100)),
        rule2Window: String(settings.rule2Window),
        rule2MinTrials: String(settings.rule2MinTrials),
        minDays: String(settings.minDays),
        maxPausesPerRun: String(settings.maxPausesPerRun),
      }
    : {};
  const draft = { ...saved, ...edits };
  const setDraft = (next: Record<string, string>) => setEdits(next);

  const latest = data?.runs?.[0];
  const evaluations: AdEvaluation[] = latest?.evaluations ?? [];
  const count = (d: AutopauseDecision) => evaluations.filter((e) => e.decision === d).length;

  const isOn = !!settings?.enabled && !data?.envKillSwitch;
  const isLive = isOn && !settings?.dryRun;

  const saveNumbers = () =>
    save.mutate({
      targetCpa: Number(draft.targetCpa),
      cutoff: Number(draft.cutoff) / 100,
      rule2Window: Number(draft.rule2Window),
      rule2MinTrials: Number(draft.rule2MinTrials),
      minDays: Number(draft.minDays),
      maxPausesPerRun: Number(draft.maxPausesPerRun),
    });

  return (
    <div>
      <Header
        title="Winners Auto-pause"
        description="Checks every ad in the Winners campaign once a day and pauses the ones that fail the rules."
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending || !settings}
          >
            {runNow.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Run check now
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendSlack.mutate()}
            disabled={sendSlack.isPending || !data?.runs?.length}
            title="Post the latest check to Slack"
          >
            {sendSlack.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {sendSlack.isSuccess ? 'Sent to Slack' : 'Send to Slack'}
          </Button>
        </div>
      </Header>

      <div className="space-y-6 p-4 md:p-8">
        {error && (
          <p className="text-sm text-red-500">Couldn&apos;t load: {(error as Error).message}</p>
        )}
        {isLoading && <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>}

        {settings && (
          <Card>
            <CardContent className="space-y-5 p-6">
              {/* Status + kill switch */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'h-3 w-3 rounded-full',
                      !isOn ? 'bg-gray-400' : isLive ? 'bg-emerald-500' : 'bg-amber-500'
                    )}
                  />
                  <div>
                    <p className="text-lg font-semibold text-[var(--color-foreground)]">
                      {!isOn
                        ? 'Stopped'
                        : isLive
                          ? 'Running — pausing ads'
                          : 'Running — dry run (checks only, pauses nothing)'}
                    </p>
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      {data?.envKillSwitch
                        ? 'Stopped by WINNERS_AUTOPAUSE_DISABLED in Vercel. Remove it to turn this back on.'
                        : !isOn
                          ? 'The daily check is off. Nothing will be checked or paused.'
                          : 'Runs every day at 8am PT on yesterday’s completed data. Posts a summary in Slack.'}
                    </p>
                  </div>
                </div>

                {isOn ? (
                  <Button
                    variant="destructive"
                    onClick={() => save.mutate({ enabled: false })}
                    disabled={save.isPending}
                  >
                    <OctagonX className="mr-2 h-4 w-4" />
                    Stop auto-pause
                  </Button>
                ) : (
                  <Button
                    variant="success"
                    onClick={() => save.mutate({ enabled: true })}
                    disabled={save.isPending || data?.envKillSwitch}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    Turn on
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] p-4">
                <Switch
                  checked={settings.dryRun}
                  onCheckedChange={(checked) => save.mutate({ dryRun: checked })}
                  disabled={save.isPending}
                />
                <div>
                  <p className="text-sm font-medium text-[var(--color-foreground)]">Dry run</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    On: posts what it <em>would</em> pause, touches nothing. Off: actually pauses
                    ads that fail.
                  </p>
                </div>
              </div>

              {!data?.persisted && (
                <p className="text-sm text-amber-600">
                  Redis isn&apos;t connected, so settings can&apos;t be saved and every run is
                  treated as a dry run.
                </p>
              )}

              {/* Numbers */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <SettingField
                  label="Target CPA"
                  hint="The CPA we hold ads to."
                  prefix="$"
                  value={draft.targetCpa ?? ''}
                  onChange={(v) => setDraft({ ...draft, targetCpa: v })}
                />
                <SettingField
                  label="Cutoff"
                  hint="Pause when a good ad would look this bad less than this often. 10 = 1 in 10."
                  suffix="%"
                  value={draft.cutoff ?? ''}
                  onChange={(v) => setDraft({ ...draft, cutoff: v })}
                />
                <SettingField
                  label="Rule 2 window"
                  hint="How much recent spend Rule 2 looks at."
                  prefix="$"
                  value={draft.rule2Window ?? ''}
                  onChange={(v) => setDraft({ ...draft, rule2Window: v })}
                />
                <SettingField
                  label="Rule 2 starts at"
                  hint="Lifetime trials before Rule 2 applies."
                  suffix="trials"
                  value={draft.rule2MinTrials ?? ''}
                  onChange={(v) => setDraft({ ...draft, rule2MinTrials: v })}
                />
                <SettingField
                  label="Rule 3"
                  hint="Days of spend before an ad can be paused."
                  suffix="days"
                  value={draft.minDays ?? ''}
                  onChange={(v) => setDraft({ ...draft, minDays: v })}
                />
                <SettingField
                  label="Max pauses per day"
                  hint="If more ads fail than this, pause none and warn (usually bad data)."
                  suffix="ads"
                  value={draft.maxPausesPerRun ?? ''}
                  onChange={(v) => setDraft({ ...draft, maxPausesPerRun: v })}
                />
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={saveNumbers} disabled={save.isPending}>
                  Save numbers
                </Button>
                {save.error && (
                  <span className="text-sm text-red-500">{(save.error as Error).message}</span>
                )}
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  Campaign {settings.campaignId}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Latest run */}
        <Card>
          <CardContent className="p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Latest check</h2>
              {latest && (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Data through {latest.throughDate} ·{' '}
                  {latest.trigger === 'preview' ? 'Run by hand' : 'Daily run'} ·{' '}
                  {new Date(latest.ranAt).toLocaleString()}
                  {latest.settings.dryRun ? ' · dry run' : ''}
                </p>
              )}
            </div>

            {runNow.error && (
              <p className="mb-3 text-sm text-red-500">{(runNow.error as Error).message}</p>
            )}
            {sendSlack.error && (
              <p className="mb-3 text-sm text-red-500">{(sendSlack.error as Error).message}</p>
            )}

            {!latest ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                No checks yet. Click “Run check now” to see what the bot would do today.
              </p>
            ) : (
              <>
                {latest.overLimit && (
                  <p className="mb-3 rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                    {count('PAUSE')} ads failed, more than the limit of{' '}
                    {latest.settings.maxPausesPerRun}. Nothing was paused — check the data.
                  </p>
                )}
                {latest.note && (
                  <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">{latest.note}</p>
                )}

                <div className="mb-4 flex flex-wrap gap-2 text-sm">
                  <Badge variant="deleted">
                    {latest.settings.dryRun || latest.overLimit ? 'Would pause' : 'Pause'}{' '}
                    {count('PAUSE')}
                  </Badge>
                  <Badge variant="paused">Watch {count('WATCH')}</Badge>
                  <Badge variant="active">OK {count('OK')}</Badge>
                  <Badge variant="secondary">Too early {count('TOO_EARLY')}</Badge>
                  {latest.paused.length > 0 && (
                    <Badge variant="deleted">Actually paused {latest.paused.length}</Badge>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ad</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead className="text-right">Spend</TableHead>
                        <TableHead className="text-right">Trials</TableHead>
                        <TableHead className="text-right">CPA</TableHead>
                        <TableHead className="text-right">Rule 1 cap</TableHead>
                        <TableHead className="text-right">Rule 1 P</TableHead>
                        <TableHead className="text-right">Trials in last $2k</TableHead>
                        <TableHead>Why</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {evaluations.map((e) => (
                        <TableRow key={e.adId}>
                          <TableCell
                            className="max-w-[280px] truncate font-medium"
                            title={e.adName}
                          >
                            <a
                              href={buildAdsManagerAdLink(
                                WONDERLY_AD_ACCOUNT_ID,
                                WONDERLY_BUSINESS_ID,
                                e.adId
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--color-primary)] hover:underline"
                            >
                              {e.adName}
                            </a>
                          </TableCell>
                          <TableCell>
                            <Badge variant={DECISION_VARIANT[e.decision]}>
                              {DECISION_LABEL[e.decision]}
                              {e.rule ? ` · ${e.rule === 'rule1' ? 'R1' : 'R2'}` : ''}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{money(e.spend)}</TableCell>
                          <TableCell className="text-right">{e.trials}</TableCell>
                          <TableCell className="text-right">{money(e.cpa)}</TableCell>
                          <TableCell className="text-right">{money(e.rule1Cap)}</TableCell>
                          <TableCell
                            className={cn(
                              'text-right',
                              e.rule1P < latest.settings.cutoff && 'font-semibold text-red-500'
                            )}
                          >
                            {(e.rule1P * 100).toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-right">
                            {e.rule2 ? `${e.rule2.trials} (line ${e.rule2.line})` : '—'}
                          </TableCell>
                          <TableCell className="text-sm text-[var(--color-muted-foreground)]">
                            {e.reason}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Plain-English rules */}
        <Card>
          <CardContent className="space-y-2 p-6 text-sm text-[var(--color-foreground)]">
            <h2 className="text-lg font-semibold">The rules</h2>
            <p>
              <strong>Rule 1 — too few trials for what it spent.</strong> “Rule 1 P” is the chance
              an ad at our target CPA would have this few trials at this spend. Under the cutoff →
              pause. The “Rule 1 cap” column is how much the ad can spend at its current trial count
              before that happens.
            </p>
            <p>
              <strong>Rule 2 — stopped working.</strong> For ads with enough trials, look only at
              the most recent $2k of spend. At or under the line → pause.
            </p>
            <p>
              <strong>Rule 3 — too early.</strong> Ads with less than 2 days of spend are never
              paused.
            </p>
            <p className="text-[var(--color-muted-foreground)]">
              The bot only pauses. It never turns ads back on or changes budgets. “Watch” means
              close to a line — worth a look, no action taken.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
