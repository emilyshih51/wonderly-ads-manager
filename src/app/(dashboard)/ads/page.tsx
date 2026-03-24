'use client';

import NextImage from 'next/image';
import { useState, useMemo } from 'react';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Select } from '@/components/ui/dropdown';
import { AdsSkeleton } from '@/components/skeletons/ads-skeleton';
import { AdsGallery } from '@/components/dashboard/ads-gallery';
import { CreativeBreakdown } from '@/components/dashboard/creative-breakdown';
import { useAppStore } from '@/stores/app-store';
import { useCampaignList } from '@/lib/queries/meta/use-campaigns';
import { useAds } from '@/lib/queries/meta/use-ads';
import { formatCurrency, formatPercent, formatNumber, cn, DATE_PRESETS } from '@/lib/utils';
import { getResultCount } from '@/lib/automation-utils';
import {
  RefreshCw,
  Trophy,
  TrendingUp,
  Image as ImageIcon,
  LayoutGrid,
  LayoutList,
  X,
} from 'lucide-react';

import { useTranslations } from 'next-intl';

function useDatePresetOptions() {
  const tCommon = useTranslations('common');

  return DATE_PRESETS.map((p) => ({ label: tCommon(p.labelKey), value: p.value }));
}

export default function TopPerformingAdsPage() {
  const t = useTranslations('ads');
  const tCommon = useTranslations('common');
  const tMetrics = useTranslations('metrics');
  const datePresetOptions = useDatePresetOptions();
  const { setDatePreset, filterCampaignId, filterAdSetId, setFilterCampaignId, setFilterAdSetId } =
    useAppStore();
  const [localDatePreset, setLocalDatePreset] = useState('last_7d');
  const [selectedCampaign, setSelectedCampaign] = useState('all');
  const [viewMode, setViewMode] = useState<'gallery' | 'table'>('gallery');

  const { data: campaigns = [] } = useCampaignList();
  const {
    data: allAds = [],
    isLoading,
    isFetching,
    refetch,
  } = useAds({ datePreset: localDatePreset });

  // Campaign filtering and ranking applied client-side via useMemo
  const ads = useMemo(() => {
    let processedAds = allAds;

    // Apply cross-table filter from Zustand (set from campaigns/adsets pages)
    if (filterCampaignId) {
      processedAds = processedAds.filter((ad) => ad.campaign_id === filterCampaignId);
    } else if (filterAdSetId) {
      processedAds = processedAds.filter((ad) => ad.adset_id === filterAdSetId);
    } else if (selectedCampaign !== 'all') {
      // Local dropdown filter (only active when no cross-table filter)
      processedAds = processedAds.filter((ad) => ad.campaign_id === selectedCampaign);
    }

    return processedAds
      .map((ad, idx) => {
        const results = getResultCount(
          { actions: ad.insights?.actions, campaign_id: ad.campaign_id },
          ad.campaign_id,
          {}
        );
        const spend = ad.insights?.spend ? parseFloat(ad.insights.spend) : 0;
        const cpa = results > 0 ? spend / results : null;

        return { ...ad, results, cpa, rank: idx + 1 };
      })
      .filter((ad) => ad.results > 0)
      .sort((a, b) => {
        if (b.results !== a.results) return b.results - a.results;
        if (a.cpa === null && b.cpa === null) return 0;
        if (a.cpa === null) return 1;
        if (b.cpa === null) return -1;

        return a.cpa - b.cpa;
      })
      .map((ad, idx) => ({ ...ad, rank: idx + 1 }))
      .slice(0, 50);
  }, [allAds, selectedCampaign, filterCampaignId, filterAdSetId]);

  const handleDatePresetChange = (value: string) => {
    setLocalDatePreset(value);
    setDatePreset(value);
  };

  // Resolve filter chip label
  const filterLabel = filterCampaignId
    ? (campaigns.find((c) => c.id === filterCampaignId)?.name ?? tCommon('campaign'))
    : null;

  const clearFilter = () => {
    setFilterCampaignId(null);
    setFilterAdSetId(null);
  };

  return (
    <div>
      <Header title={t('title')} description={t('description')}>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-[var(--color-border)] p-0.5">
            <button
              className={cn(
                'rounded-md p-1.5 transition-colors',
                viewMode === 'gallery'
                  ? 'bg-[var(--color-accent)] text-[var(--color-foreground)]'
                  : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
              )}
              onClick={() => setViewMode('gallery')}
              aria-label={tCommon('galleryView')}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              className={cn(
                'rounded-md p-1.5 transition-colors',
                viewMode === 'table'
                  ? 'bg-[var(--color-accent)] text-[var(--color-foreground)]'
                  : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
              )}
              onClick={() => setViewMode('table')}
              aria-label={tCommon('tableView')}
            >
              <LayoutList className="h-4 w-4" />
            </button>
          </div>

          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin')} />
            {tCommon('refresh')}
          </Button>
        </div>
      </Header>

      <div className="p-8">
        {/* Cross-table filter chip */}
        {filterLabel && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-[var(--color-muted-foreground)]">
              {tCommon('filteredBy')}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary)] px-3 py-1 text-sm font-medium text-[var(--color-primary-foreground)]">
              {filterLabel}
              <button
                onClick={clearFilter}
                className="ml-1 rounded-full p-0.5 hover:bg-white/20"
                aria-label={tCommon('clearFilter')}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        {/* Filters Row — only shown when no cross-table filter active */}
        {!filterCampaignId && !filterAdSetId && (
          <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-sm font-medium text-[var(--color-foreground)]">
                {tCommon('campaign')}
              </label>
              <Select
                value={selectedCampaign}
                onChange={setSelectedCampaign}
                options={[
                  { label: tCommon('allCampaigns'), value: 'all' },
                  ...campaigns.map((c) => ({ label: c.name, value: c.id })),
                ]}
              />
            </div>

            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-sm font-medium text-[var(--color-foreground)]">
                {tCommon('dateRange')}
              </label>
              <Select
                value={localDatePreset}
                onChange={handleDatePresetChange}
                options={datePresetOptions}
              />
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading ? (
          <AdsSkeleton />
        ) : ads.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <Trophy className="mx-auto mb-3 h-12 w-12 text-[var(--color-muted-foreground)]" />
              <p className="text-lg font-medium text-[var(--color-foreground)]">
                {t('noAdsFound')}
              </p>
            </CardContent>
          </Card>
        ) : viewMode === 'gallery' ? (
          <>
            <AdsGallery ads={ads} />
            <div className="mt-6">
              <CreativeBreakdown ads={ads} />
            </div>
          </>
        ) : (
          /* Table view */
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]">
                  <th className="w-12 px-6 py-3 text-left text-xs font-semibold text-[var(--color-muted-foreground)]">
                    #
                  </th>
                  <th className="w-12 px-6 py-3 text-left text-xs font-semibold text-[var(--color-muted-foreground)]">
                    {tCommon('image')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--color-muted-foreground)]">
                    {tMetrics('adName')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--color-muted-foreground)]">
                    {tCommon('campaign')}
                  </th>
                  <th className="w-20 px-6 py-3 text-left text-xs font-semibold text-[var(--color-muted-foreground)]">
                    {tCommon('status')}
                  </th>
                  <th className="w-24 px-6 py-3 text-right text-xs font-semibold text-[var(--color-muted-foreground)]">
                    {tMetrics('results')}
                  </th>
                  <th className="w-20 px-6 py-3 text-right text-xs font-semibold text-[var(--color-muted-foreground)]">
                    {tMetrics('cpa')}
                  </th>
                  <th className="w-20 px-6 py-3 text-right text-xs font-semibold text-[var(--color-muted-foreground)]">
                    {tMetrics('spend')}
                  </th>
                  <th className="w-16 px-6 py-3 text-right text-xs font-semibold text-[var(--color-muted-foreground)]">
                    {tMetrics('ctrPercent')}
                  </th>
                  <th className="w-16 px-6 py-3 text-right text-xs font-semibold text-[var(--color-muted-foreground)]">
                    {tMetrics('clicks')}
                  </th>
                  <th className="w-24 px-6 py-3 text-right text-xs font-semibold text-[var(--color-muted-foreground)]">
                    {tMetrics('impressions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ads.map((ad, idx) => (
                  <tr
                    key={ad.id}
                    className={cn(
                      'border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-accent)]',
                      idx % 2 === 0 ? 'bg-[var(--color-card)]' : 'bg-[var(--color-muted)]'
                    )}
                  >
                    <td className="px-6 py-4 text-sm font-semibold text-[var(--color-foreground)]">
                      {ad.rank}
                    </td>

                    <td className="px-6 py-4">
                      {ad.creative?.image_url || ad.creative?.thumbnail_url ? (
                        <NextImage
                          src={ad.creative.image_url || ad.creative.thumbnail_url || ''}
                          alt={ad.name}
                          width={40}
                          height={40}
                          className="rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded bg-[var(--color-muted)]">
                          <ImageIcon className="h-5 w-5 text-[var(--color-muted-foreground)]" />
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      <p className="max-w-xs truncate text-sm font-medium text-[var(--color-foreground)]">
                        {ad.name}
                      </p>
                      {ad.creative?.body && (
                        <p className="line-clamp-1 text-xs text-[var(--color-muted-foreground)]">
                          {ad.creative.body}
                        </p>
                      )}
                    </td>

                    <td className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">
                      {ad.campaign_name || '—'}
                    </td>

                    <td className="px-6 py-4">
                      <StatusBadge status={ad.status} />
                    </td>

                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <TrendingUp className="h-4 w-4" />
                        <span className="text-sm font-bold">{formatNumber(ad.results)}</span>
                      </div>
                    </td>

                    <td className="px-6 py-4 text-right text-sm font-medium text-[var(--color-foreground)]">
                      {ad.cpa !== null ? formatCurrency(ad.cpa) : '—'}
                    </td>

                    <td className="px-6 py-4 text-right text-sm font-medium text-[var(--color-foreground)]">
                      {ad.insights?.spend ? formatCurrency(ad.insights.spend) : '—'}
                    </td>

                    <td className="px-6 py-4 text-right text-sm font-medium text-[var(--color-foreground)]">
                      {ad.insights?.ctr ? formatPercent(ad.insights.ctr) : '—'}
                    </td>

                    <td className="px-6 py-4 text-right text-sm font-medium text-[var(--color-foreground)]">
                      {ad.insights?.clicks ? formatNumber(ad.insights.clicks) : '—'}
                    </td>

                    <td className="px-6 py-4 text-right text-sm font-medium text-[var(--color-foreground)]">
                      {ad.insights?.impressions ? formatNumber(ad.insights.impressions) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary */}
        {!isLoading && ads.length > 0 && (
          <div className="mt-6 text-sm text-[var(--color-muted-foreground)]">
            {tCommon('showing')}{' '}
            <span className="font-semibold text-[var(--color-foreground)]">{ads.length}</span>{' '}
            {tCommon('topPerformingAds')}
          </div>
        )}
      </div>
    </div>
  );
}
