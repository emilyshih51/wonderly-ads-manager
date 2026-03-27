'use client';

import * as React from 'react';
import NextImage from 'next/image';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { cn, formatCurrency, formatPercent, formatNumber, formatCtaLabel } from '@/lib/utils';
import { getResultCount } from '@/lib/automation-utils';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Play, TrendingUp, X } from 'lucide-react';
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

/** Small label + value metric used inside carousel cards. */
function CardMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] text-[var(--color-muted-foreground)]">{label}</p>
      <p className="truncate text-xs font-semibold text-[var(--color-foreground)] tabular-nums">
        {value}
      </p>
    </div>
  );
}

const CARD_WIDTH = 300;
const SCROLL_AMOUNT = CARD_WIDTH + 16; // card width + gap

/**
 * Horizontal snap-scroll carousel of ad cards with click-to-expand slide panel.
 * Swipe on mobile, arrow buttons on desktop. Each card shows 5 key metrics and an ad copy snippet.
 *
 * @param ads - Ranked ads to display
 */
export function AdsGallery({ ads }: AdsGalleryProps) {
  const tMetrics = useTranslations('metrics');
  const tCommon = useTranslations('common');
  const [selected, setSelected] = React.useState<RankedAd | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);
  const [scrollProgress, setScrollProgress] = React.useState(0);

  React.useEffect(() => {
    const el = scrollRef.current;

    if (!el) return;

    const update = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;

      setCanScrollLeft(el.scrollLeft > 0);
      setCanScrollRight(el.scrollLeft < maxScroll - 1);
      setScrollProgress(maxScroll > 0 ? el.scrollLeft / maxScroll : 0);
    };

    el.addEventListener('scroll', update, { passive: true });

    const ro = new ResizeObserver(update);

    ro.observe(el);
    update();

    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [ads.length]);

  const scroll = (direction: 'left' | 'right') => {
    scrollRef.current?.scrollBy({
      left: direction === 'left' ? -SCROLL_AMOUNT : SCROLL_AMOUNT,
      behavior: 'smooth',
    });
  };

  return (
    <>
      <div className="relative">
        {/* Left arrow */}
        <Button
          variant="outline"
          size="icon"
          onClick={() => scroll('left')}
          disabled={!canScrollLeft}
          className="absolute top-1/2 -left-3 z-10 hidden -translate-y-1/2 rounded-full p-2 shadow-lg transition-all hover:scale-110 disabled:opacity-0 sm:flex"
          aria-label={tCommon('scrollLeft')}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        {/* Right arrow */}
        <Button
          variant="outline"
          size="icon"
          onClick={() => scroll('right')}
          disabled={!canScrollRight}
          className="absolute top-1/2 -right-3 z-10 hidden -translate-y-1/2 rounded-full p-2 shadow-lg transition-all hover:scale-110 disabled:opacity-0 sm:flex"
          aria-label={tCommon('scrollRight')}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>

        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="scrollbar-hide flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-1 py-1"
        >
          {ads.map((ad) => {
            const imgSrc =
              ad.creative?.effective_image_url ||
              ad.creative?.image_url ||
              ad.creative?.thumbnail_url;
            const isVideo = !!ad.creative?.video_id;
            const spend = ad.insights?.spend ? parseFloat(ad.insights.spend) : 0;
            const copySnippet = ad.creative?.title || ad.creative?.body;

            return (
              <button
                key={ad.id}
                className="group relative flex w-[280px] shrink-0 cursor-pointer snap-start flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-left shadow-sm transition-all hover:shadow-md hover:ring-2 hover:ring-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)] focus-visible:outline-none sm:w-[300px] lg:w-[320px]"
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
                      sizes="320px"
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
                  {/* Video play icon */}
                  {isVideo && imgSrc && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white">
                        <Play className="h-5 w-5 fill-current" />
                      </div>
                    </div>
                  )}
                  {/* Rank badge */}
                  <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white">
                    {ad.rank}
                  </div>
                </div>

                {/* Card body */}
                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">
                    {ad.name}
                  </p>
                  {ad.campaign_name && (
                    <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                      {ad.campaign_name}
                    </p>
                  )}
                  {copySnippet && (
                    <p className="truncate text-xs text-[var(--color-muted-foreground)] italic">
                      &ldquo;{copySnippet}&rdquo;
                    </p>
                  )}

                  {/* 5 key metrics */}
                  <div className="mt-auto border-t border-[var(--color-border)] pt-2">
                    <div className="mb-1.5 flex w-fit items-center gap-1 self-start rounded-full bg-green-100 px-2 py-0.5 dark:bg-green-900/30">
                      <TrendingUp className="h-3 w-3 text-green-700 dark:text-green-400" />
                      <span className="text-xs font-bold text-green-700 dark:text-green-400">
                        {formatNumber(ad.results)} {tMetrics('results').toLowerCase()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      <CardMetric
                        label={tMetrics('spend')}
                        value={spend > 0 ? formatCurrency(spend) : '—'}
                      />
                      <CardMetric
                        label={tMetrics('costPerResult')}
                        value={ad.cpa != null ? formatCurrency(ad.cpa) : '—'}
                      />
                      <CardMetric
                        label={tMetrics('impressions')}
                        value={
                          ad.insights?.impressions ? formatNumber(ad.insights.impressions) : '—'
                        }
                      />
                      <CardMetric
                        label={tMetrics('ctr')}
                        value={ad.insights?.ctr ? formatPercent(ad.insights.ctr) : '—'}
                      />
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Progress bar */}
        {ads.length > 1 && (
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1 flex-1 rounded-full bg-[var(--color-muted)]">
              <div
                className="h-1 rounded-full bg-[var(--color-primary)] transition-all duration-200"
                style={{ width: `${Math.max(5, scrollProgress * 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-xs text-[var(--color-muted-foreground)] tabular-nums">
              {ads.length} {ads.length === 1 ? tCommon('ad') : tCommon('ads')}
            </span>
          </div>
        )}
      </div>

      {/* Detail modal */}
      <DialogPrimitive.Root
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 data-[state=closed]:animate-[overlay-hide_200ms_ease-in] data-[state=open]:animate-[overlay-show_300ms_ease-out]">
            <DialogPrimitive.Content
              className={cn(
                'flex max-h-[90vh] w-[95vw] max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl',
                'data-[state=open]:animate-[modal-in_300ms_cubic-bezier(0.16,1,0.3,1)]',
                'data-[state=closed]:animate-[modal-out_200ms_ease-in]'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex shrink-0 items-start justify-between border-b border-[var(--color-border)] px-6 py-4">
                <div className="min-w-0 space-y-0.5 pr-4">
                  <DialogPrimitive.Title className="truncate text-base font-semibold text-[var(--color-foreground)]">
                    {selected?.name}
                  </DialogPrimitive.Title>
                  {selected?.campaign_name && (
                    <DialogPrimitive.Description className="truncate text-sm text-[var(--color-muted-foreground)]">
                      {selected.campaign_name}
                    </DialogPrimitive.Description>
                  )}
                </div>
                <DialogPrimitive.Close className="shrink-0 cursor-pointer rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none">
                  <X className="h-5 w-5" />
                </DialogPrimitive.Close>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6">
                {selected && <AdDetail ad={selected} />}
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Overlay>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

/** Full ad detail rendered inside the modal — two-column on desktop, stacked on mobile. */
function AdDetail({ ad }: { ad: RankedAd }) {
  const tMetrics = useTranslations('metrics');
  const imgSrc =
    ad.creative?.effective_image_url || ad.creative?.image_url || ad.creative?.thumbnail_url;
  const videoSrc = ad.creative?.video_source;
  const spend = ad.insights?.spend ? parseFloat(ad.insights.spend) : 0;
  const results = getResultCount(
    { actions: ad.insights?.actions, campaign_id: ad.campaign_id },
    ad.campaign_id,
    {}
  );

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Left column — creative + copy */}
      <div className="space-y-4">
        {videoSrc ? (
          <div className="relative w-full overflow-hidden rounded-lg bg-black">
            {}
            <video
              src={videoSrc}
              controls
              playsInline
              preload="metadata"
              poster={imgSrc || undefined}
              className="w-full"
            />
          </div>
        ) : imgSrc ? (
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-[var(--color-muted)]">
            <NextImage
              src={imgSrc}
              alt={ad.name}
              fill
              className="object-contain"
              sizes="(max-width: 768px) 90vw, 45vw"
            />
          </div>
        ) : null}

        {(ad.creative?.title || ad.creative?.body) && (
          <div className="space-y-2">
            {ad.creative.title && (
              <p className="text-sm font-semibold text-[var(--color-foreground)]">
                {ad.creative.title}
              </p>
            )}
            {ad.creative.body && (
              <p className="text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                {ad.creative.body}
              </p>
            )}
            {ad.creative.link_url && (
              <a
                href={ad.creative.link_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block cursor-pointer truncate text-xs text-[var(--color-primary)] hover:underline"
              >
                {ad.creative.link_url}
              </a>
            )}
            {ad.creative.call_to_action_type && (
              <span className="inline-block rounded bg-[var(--color-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-foreground)]">
                {formatCtaLabel(ad.creative.call_to_action_type)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right column — rank, metrics */}
      <div className="space-y-4">
        {/* Rank + status */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary)] text-sm font-bold text-white">
            #{ad.rank}
          </div>
          <StatusBadge status={ad.status} />
        </div>

        {/* Highlight metrics */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-[var(--color-muted-foreground)]">{tMetrics('results')}</p>
              <p className="text-lg font-bold text-green-600 tabular-nums dark:text-green-400">
                {formatNumber(results)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {tMetrics('costPerResult')}
              </p>
              <p className="text-lg font-bold text-[var(--color-foreground)] tabular-nums">
                {results > 0 && spend > 0 ? formatCurrency(spend / results) : '—'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* All performance metrics */}
        <Card>
          <CardContent className="divide-y divide-[var(--color-border)] p-4">
            <MetricRow label={tMetrics('spend')} value={spend > 0 ? formatCurrency(spend) : '—'} />
            <MetricRow
              label={tMetrics('impressions')}
              value={ad.insights?.impressions ? formatNumber(ad.insights.impressions) : '—'}
            />
            <MetricRow
              label={tMetrics('clicks')}
              value={ad.insights?.clicks ? formatNumber(ad.insights.clicks) : '—'}
            />
            <MetricRow
              label={tMetrics('ctr')}
              value={ad.insights?.ctr ? formatPercent(ad.insights.ctr) : '—'}
            />
            <MetricRow
              label={tMetrics('cpc')}
              value={ad.insights?.cpc ? formatCurrency(ad.insights.cpc) : '—'}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
