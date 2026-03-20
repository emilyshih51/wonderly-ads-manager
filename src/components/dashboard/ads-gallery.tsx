'use client';

import * as React from 'react';
import NextImage from 'next/image';
import { StatusBadge } from '@/components/ui/badge';
import { SlidePanel } from '@/components/data/slide-panel';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils';
import { getResultCount } from '@/lib/automation-utils';
import { Image as ImageIcon, TrendingUp } from 'lucide-react';
import type { AdRow } from '@/lib/queries/meta/use-ads';

interface RankedAd extends AdRow {
  results: number;
  cpa: number | null;
  rank: number;
}

interface AdsGalleryProps {
  ads: RankedAd[];
}

interface MetricRowProps {
  label: string;
  value: string;
}

function MetricRow({ label, value }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className="font-medium text-[var(--color-foreground)]">{value}</span>
    </div>
  );
}

/**
 * Gallery grid of ad cards with click-to-expand slide panel.
 * Renders responsive columns: 1 col on mobile, 2 on sm, 3 on lg, 4 on xl.
 *
 * @param ads - Ranked ads to display
 */
export function AdsGallery({ ads }: AdsGalleryProps) {
  const [selected, setSelected] = React.useState<RankedAd | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ads.map((ad) => {
          const imgSrc = ad.creative?.thumbnail_url || ad.creative?.image_url;
          const spend = ad.insights?.spend ? parseFloat(ad.insights.spend) : 0;

          return (
            <button
              key={ad.id}
              className="group relative flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-left shadow-sm transition-all hover:shadow-md hover:ring-2 hover:ring-[var(--color-primary)]"
              onClick={() => setSelected(ad)}
            >
              {/* Creative image */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--color-muted)]">
                {imgSrc ? (
                  <NextImage
                    src={imgSrc}
                    alt={ad.name}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageIcon className="h-10 w-10 text-[var(--color-muted-foreground)]" />
                  </div>
                )}
                {/* Status badge overlay */}
                <div className="absolute top-2 left-2">
                  <StatusBadge status={ad.status} />
                </div>
                {/* Rank badge */}
                <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white">
                  {ad.rank}
                </div>
              </div>

              {/* Card body */}
              <div className="flex flex-1 flex-col gap-2 p-3">
                <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">
                  {ad.name}
                </p>
                {ad.campaign_name && (
                  <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                    {ad.campaign_name}
                  </p>
                )}

                {/* 3 key metrics */}
                <div className="mt-auto flex items-center justify-between pt-2">
                  <div className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 dark:bg-green-900/30">
                    <TrendingUp className="h-3 w-3 text-green-700 dark:text-green-400" />
                    <span className="text-xs font-bold text-green-700 dark:text-green-400">
                      {formatNumber(ad.results)}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    {spend > 0 ? formatCurrency(spend) : '—'}
                  </span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    {ad.insights?.ctr ? formatPercent(ad.insights.ctr) : '—'} CTR
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail slide panel */}
      <SlidePanel
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected?.name ?? ''}
        description={selected?.campaign_name ?? ''}
      >
        {selected && <AdDetail ad={selected} />}
      </SlidePanel>
    </>
  );
}

/** Full ad detail rendered inside the SlidePanel. */
function AdDetail({ ad }: { ad: RankedAd }) {
  const imgSrc = ad.creative?.thumbnail_url || ad.creative?.image_url;
  const spend = ad.insights?.spend ? parseFloat(ad.insights.spend) : 0;
  const results = getResultCount(
    { actions: ad.insights?.actions, campaign_id: ad.campaign_id },
    ad.campaign_id,
    {}
  );

  return (
    <div className="space-y-6">
      {/* Creative preview */}
      {imgSrc && (
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-[var(--color-muted)]">
          <NextImage src={imgSrc} alt={ad.name} fill className="object-contain" sizes="480px" />
        </div>
      )}

      {/* Ad copy */}
      {(ad.creative?.title || ad.creative?.body) && (
        <Card>
          <CardContent className="space-y-2 p-4">
            {ad.creative.title && (
              <p className="text-sm font-semibold text-[var(--color-foreground)]">
                {ad.creative.title}
              </p>
            )}
            {ad.creative.body && (
              <p className="text-sm text-[var(--color-muted-foreground)]">{ad.creative.body}</p>
            )}
            {ad.creative.link_url && (
              <p className="truncate text-xs text-[var(--color-primary)]">{ad.creative.link_url}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Performance metrics */}
      <Card>
        <CardContent className="divide-y divide-[var(--color-border)] p-4">
          <MetricRow label="Results" value={formatNumber(results)} />
          <MetricRow label="Spend" value={spend > 0 ? formatCurrency(spend) : '—'} />
          <MetricRow
            label="Cost per Result"
            value={results > 0 && spend > 0 ? formatCurrency(spend / results) : '—'}
          />
          <MetricRow label="CTR" value={ad.insights?.ctr ? formatPercent(ad.insights.ctr) : '—'} />
          <MetricRow label="CPC" value={ad.insights?.cpc ? formatCurrency(ad.insights.cpc) : '—'} />
          <MetricRow
            label="Impressions"
            value={ad.insights?.impressions ? formatNumber(ad.insights.impressions) : '—'}
          />
          <MetricRow
            label="Clicks"
            value={ad.insights?.clicks ? formatNumber(ad.insights.clicks) : '—'}
          />
        </CardContent>
      </Card>

      {/* Status */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--color-muted-foreground)]">Status:</span>
        <StatusBadge status={ad.status} />
      </div>
    </div>
  );
}
