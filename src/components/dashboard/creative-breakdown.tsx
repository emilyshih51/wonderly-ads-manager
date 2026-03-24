'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { cn, formatNumber, formatCurrency } from '@/lib/utils';
import { TrendingUp, Type, MessageSquare, MousePointerClick } from 'lucide-react';
import type { AdRow } from '@/lib/queries/meta/use-ads';

interface RankedAd extends AdRow {
  results: number;
  cpa: number | null;
  rank: number;
}

interface CreativeBreakdownProps {
  ads: RankedAd[];
}

interface AggregatedCreative {
  value: string;
  totalResults: number;
  totalSpend: number;
  adCount: number;
  avgCpa: number | null;
}

/**
 * Aggregate ads by a creative field (headline, body, or CTA) and rank by total conversions.
 */
function aggregateByField(
  ads: RankedAd[],
  extractor: (ad: RankedAd) => string | undefined
): AggregatedCreative[] {
  const map = new Map<string, { results: number; spend: number; count: number }>();

  for (const ad of ads) {
    const value = extractor(ad)?.trim();

    if (!value) continue;

    const existing = map.get(value) || { results: 0, spend: 0, count: 0 };

    existing.results += ad.results;
    existing.spend += ad.insights?.spend ? parseFloat(ad.insights.spend) : 0;
    existing.count += 1;
    map.set(value, existing);
  }

  return Array.from(map.entries())
    .map(([value, data]) => ({
      value,
      totalResults: data.results,
      totalSpend: data.spend,
      adCount: data.count,
      avgCpa: data.results > 0 ? data.spend / data.results : null,
    }))
    .sort((a, b) => b.totalResults - a.totalResults)
    .slice(0, 5);
}

function BreakdownSection({
  title,
  icon,
  items,
  maxResults,
}: {
  title: string;
  icon: React.ReactNode;
  items: AggregatedCreative[];
  maxResults: number;
}) {
  const t = useTranslations('dashboard');
  const tMetrics = useTranslations('metrics');

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <h4 className="text-sm font-medium text-[var(--color-foreground)]">{title}</h4>
      </div>
      <div className="space-y-1.5">
        {items.map((item, idx) => {
          const barWidth = maxResults > 0 ? (item.totalResults / maxResults) * 100 : 0;

          return (
            <div
              key={item.value}
              className="relative overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3"
            >
              {/* Background bar */}
              <div
                className="absolute inset-y-0 left-0 bg-green-50 dark:bg-green-900/20"
                style={{ width: `${barWidth}%` }}
              />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                        idx === 0
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                          : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
                      )}
                    >
                      {idx + 1}
                    </span>
                    <p className="truncate text-sm text-[var(--color-foreground)]">{item.value}</p>
                  </div>
                  <p className="mt-0.5 ml-7 text-[10px] text-[var(--color-muted-foreground)]">
                    {t('adsCount', { count: item.adCount })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  <div className="text-right">
                    <span className="font-bold text-green-600 dark:text-green-400">
                      {formatNumber(item.totalResults)}
                    </span>
                    <span className="ml-1 text-[var(--color-muted-foreground)]">
                      {tMetrics('results').toLowerCase()}
                    </span>
                  </div>
                  {item.avgCpa != null && (
                    <div className="text-right text-[var(--color-muted-foreground)]">
                      {formatCurrency(item.avgCpa)} {tMetrics('cpa').toLowerCase()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Shows which headlines, primary texts, and CTAs produced the most conversions/results.
 * Aggregates across all ranked ads and displays a top-5 breakdown for each creative element.
 */
export function CreativeBreakdown({ ads }: CreativeBreakdownProps) {
  const t = useTranslations('dashboard');

  const headlines = React.useMemo(() => aggregateByField(ads, (ad) => ad.creative?.title), [ads]);
  const primaryTexts = React.useMemo(() => aggregateByField(ads, (ad) => ad.creative?.body), [ads]);
  const ctas = React.useMemo(
    () =>
      aggregateByField(ads, (ad) =>
        ad.creative?.call_to_action_type
          ? ad.creative.call_to_action_type.replace(/_/g, ' ')
          : undefined
      ),
    [ads]
  );

  if (headlines.length === 0 && primaryTexts.length === 0 && ctas.length === 0) {
    return null;
  }

  const globalMax = Math.max(
    headlines[0]?.totalResults ?? 0,
    primaryTexts[0]?.totalResults ?? 0,
    ctas[0]?.totalResults ?? 0
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3 md:px-5">
        <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
        <h3 className="text-sm font-medium text-[var(--color-foreground)]">
          {t('creativeBreakdown')}
        </h3>
        <span className="text-xs text-[var(--color-muted-foreground)]">{t('byConversions')}</span>
      </div>
      <CardContent className="space-y-5 p-4 md:p-5">
        <BreakdownSection
          title={t('topHeadlines')}
          icon={<Type className="h-4 w-4 text-blue-500" />}
          items={headlines}
          maxResults={globalMax}
        />
        <BreakdownSection
          title={t('topPrimaryTexts')}
          icon={<MessageSquare className="h-4 w-4 text-purple-500" />}
          items={primaryTexts}
          maxResults={globalMax}
        />
        <BreakdownSection
          title={t('topCTAs')}
          icon={<MousePointerClick className="h-4 w-4 text-orange-500" />}
          items={ctas}
          maxResults={globalMax}
        />
      </CardContent>
    </Card>
  );
}
