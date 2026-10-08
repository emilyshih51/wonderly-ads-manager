'use client';

import { ArrowRight, ExternalLink } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';
import type { AdEvaluation, AutopauseDecision } from '@/lib/winners-autopause';

export const DECISION_LABEL: Record<AutopauseDecision, string> = {
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

const money = (n: number | null) =>
  n === null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;

/** How far an ad is toward its Rule 1 cap. Red once it's past it. */
function CapMeter({ spend, cap, p }: { spend: number; cap: number; p: number }) {
  const ratio = cap > 0 ? spend / cap : 0;
  const color = ratio >= 1 ? 'bg-red-500' : ratio >= 0.9 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="w-36" title={`Chance a good ad would look this bad: ${(p * 100).toFixed(1)}%`}>
      <div className="flex justify-between text-xs tabular-nums">
        <span className="font-medium text-[var(--color-foreground)]">{money(spend)}</span>
        <span className="text-[var(--color-muted-foreground)]">of {money(cap)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-accent)]">
        <div
          className={cn('h-full rounded-full', color)}
          style={{ width: `${Math.min(ratio, 1) * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Every ad from a check. When `before` is passed (previewing unsaved rule changes), rows
 * whose result changed show "before → after".
 */
export function ResultsTable({
  evaluations,
  before,
}: {
  evaluations: AdEvaluation[];
  before?: Map<string, AutopauseDecision>;
}) {
  if (evaluations.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
        No ads in this group.
      </p>
    );
  }

  const link = (adId: string) =>
    buildAdsManagerAdLink(WONDERLY_AD_ACCOUNT_ID, WONDERLY_BUSINESS_ID, adId);

  const result = (e: AdEvaluation) => {
    const was = before?.get(e.adId);
    const changed = was !== undefined && was !== e.decision;

    return {
      changed,
      node: (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          {changed && (
            <>
              <Badge variant={DECISION_VARIANT[was]} className="opacity-50">
                {DECISION_LABEL[was]}
              </Badge>
              <ArrowRight className="h-3 w-3 text-[var(--color-muted-foreground)]" />
            </>
          )}
          <Badge variant={DECISION_VARIANT[e.decision]}>
            {DECISION_LABEL[e.decision]}
            {e.rule ? ` · ${e.rule === 'rule1' ? 'R1' : 'R2'}` : ''}
          </Badge>
        </span>
      ),
    };
  };

  const last2k = (e: AdEvaluation) =>
    e.rule2 ? (
      <span className={cn(e.rule2.trials <= e.rule2.line && 'font-semibold text-red-500')}>
        {e.rule2.trials}
        <span className="text-xs font-normal text-[var(--color-muted-foreground)]">
          {' '}
          / line {e.rule2.line}
        </span>
      </span>
    ) : (
      <span className="text-[var(--color-muted-foreground)]">—</span>
    );

  return (
    <>
      {/* Phones: one card per ad */}
      <ul className="space-y-2 md:hidden">
        {evaluations.map((e) => {
          const r = result(e);

          return (
            <li
              key={e.adId}
              className={cn(
                'rounded-xl border border-[var(--color-border)] p-3',
                r.changed && 'bg-[var(--color-primary)]/5'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <a
                  href={link(e.adId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 text-sm font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)]"
                >
                  {e.adName}
                </a>
                {r.node}
              </div>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{e.reason}</p>
              <div className="mt-2 flex items-end justify-between gap-3">
                <CapMeter spend={e.spend} cap={e.rule1Cap} p={e.rule1P} />
                <div className="text-right text-xs text-[var(--color-muted-foreground)] tabular-nums">
                  {e.trials} trials · {money(e.cpa)} CPA
                  <br />
                  Last $2k: {last2k(e)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[280px]">Ad · why</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Spend vs Rule 1 cap</TableHead>
              <TableHead className="text-right">Trials</TableHead>
              <TableHead className="text-right">CPA</TableHead>
              <TableHead className="text-right whitespace-nowrap">Last $2k</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evaluations.map((e) => {
              const r = result(e);

              return (
                <TableRow key={e.adId} className={cn(r.changed && 'bg-[var(--color-primary)]/5')}>
                  <TableCell className="max-w-[340px]">
                    <a
                      href={link(e.adId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${e.adName} — open in Ads Manager`}
                      className="group inline-flex max-w-full items-center gap-1 font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)]"
                    >
                      <span className="truncate">{e.adName}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-100" />
                    </a>
                    <p
                      className="mt-0.5 truncate text-xs text-[var(--color-muted-foreground)]"
                      title={e.reason}
                    >
                      {e.reason}
                    </p>
                  </TableCell>
                  <TableCell>{r.node}</TableCell>
                  <TableCell>
                    <CapMeter spend={e.spend} cap={e.rule1Cap} p={e.rule1P} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{e.trials}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(e.cpa)}</TableCell>
                  <TableCell className="text-right tabular-nums">{last2k(e)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
