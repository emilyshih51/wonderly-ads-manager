'use client';

import NextImage from 'next/image';
import { useEffect, useState, useCallback } from 'react';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { useAppStore } from '@/stores/app-store';
import {
  formatCurrency,
  formatPercent,
  formatNumber,
  DATE_PRESETS,
  getResultsFromActions,
} from '@/lib/utils';
import { RefreshCw, Loader2, Trophy, TrendingUp, Image as ImageIcon } from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
}

interface AdInsight {
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpc: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
}

interface Ad {
  id: string;
  name: string;
  campaign_id: string;
  campaign_name?: string;
  status: string;
  creative?: {
    title?: string;
    body?: string;
    thumbnail_url?: string;
    image_url?: string;
  };
  insights?: AdInsight | null;
}

interface RankedAd extends Ad {
  results: number;
  cpa: number | null;
  rank: number;
}

const DATE_PRESET_OPTIONS = DATE_PRESETS.map((p) => ({ label: p.label, value: p.value }));

export default function TopPerformingAdsPage() {
  const { setDatePreset } = useAppStore();
  const [localDatePreset, setLocalDatePreset] = useState('last_7d');
  const [selectedCampaign, setSelectedCampaign] = useState('all');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [ads, setAds] = useState<RankedAd[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);

    try {
      // Fetch campaigns and ads in parallel
      const [campaignsRes, adsRes] = await Promise.all([
        fetch('/api/meta/campaigns'),
        fetch(`/api/meta/ads?with_insights=true&date_preset=${localDatePreset}`),
      ]);

      const campaignsData = await campaignsRes.json();
      const adsData = await adsRes.json();

      setCampaigns(campaignsData.data || []);

      // Process ads: filter, calculate results, rank, and sort
      let processedAds = (adsData.data || []) as Ad[];

      // Filter by campaign if selected
      if (selectedCampaign !== 'all') {
        processedAds = processedAds.filter((ad) => ad.campaign_id === selectedCampaign);
      }

      // Map to ranked ads with results and CPA
      const rankedAds = processedAds
        .map((ad, idx) => {
          const results = getResultsFromActions(ad.insights?.actions);
          const spend = ad.insights?.spend ? parseFloat(ad.insights.spend) : 0;
          const cpa = results > 0 ? spend / results : null;

          return {
            ...ad,
            results,
            cpa,
            rank: idx + 1,
          };
        })
        // Filter to only ads with results
        .filter((ad) => ad.results > 0)
        // Sort by results DESC, then by CPA ASC (lower cost per result is better)
        .sort((a, b) => {
          if (b.results !== a.results) {
            return b.results - a.results;
          }

          if (a.cpa === null && b.cpa === null) return 0;
          if (a.cpa === null) return 1;
          if (b.cpa === null) return -1;

          return a.cpa - b.cpa;
        })
        // Re-rank after sorting
        .map((ad, idx) => ({
          ...ad,
          rank: idx + 1,
        }))
        // Take top 50
        .slice(0, 50);

      setAds(rankedAds);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, [localDatePreset, selectedCampaign]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDatePresetChange = (value: string) => {
    setLocalDatePreset(value);
    setDatePreset(value);
  };

  return (
    <div>
      <Header title="Top Performing Ads" description="Your best performing ads ranked by results">
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </Header>

      <div className="p-8">
        {/* Filters Row */}
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-sm font-medium text-gray-700">Campaign</label>
            <SelectNative
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              options={[
                { label: 'All Campaigns', value: 'all' },
                ...campaigns.map((c) => ({ label: c.name, value: c.id })),
              ]}
            />
          </div>

          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-sm font-medium text-gray-700">Date Range</label>
            <SelectNative
              value={localDatePreset}
              onChange={(e) => handleDatePresetChange(e.target.value)}
              options={DATE_PRESET_OPTIONS}
            />
          </div>
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : ads.length === 0 ? (
          /* Empty State */
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <Trophy className="mx-auto mb-3 h-12 w-12 text-gray-300" />
              <p className="text-lg font-medium text-gray-700">
                No ads with results found for this period
              </p>
              <p className="mt-1 text-sm text-gray-500">Try adjusting your filters or date range</p>
            </CardContent>
          </Card>
        ) : (
          /* Table */
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-12 px-6 py-3 text-left text-xs font-semibold text-gray-700">
                    #
                  </th>
                  <th className="w-12 px-6 py-3 text-left text-xs font-semibold text-gray-700">
                    Image
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">
                    Ad Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700">
                    Campaign
                  </th>
                  <th className="w-20 px-6 py-3 text-left text-xs font-semibold text-gray-700">
                    Status
                  </th>
                  <th className="w-24 px-6 py-3 text-left text-right text-xs font-semibold text-gray-700">
                    Results
                  </th>
                  <th className="w-20 px-6 py-3 text-left text-right text-xs font-semibold text-gray-700">
                    CPA
                  </th>
                  <th className="w-20 px-6 py-3 text-left text-right text-xs font-semibold text-gray-700">
                    Spend
                  </th>
                  <th className="w-16 px-6 py-3 text-left text-right text-xs font-semibold text-gray-700">
                    CTR %
                  </th>
                  <th className="w-16 px-6 py-3 text-left text-right text-xs font-semibold text-gray-700">
                    Clicks
                  </th>
                  <th className="w-24 px-6 py-3 text-left text-right text-xs font-semibold text-gray-700">
                    Impressions
                  </th>
                </tr>
              </thead>
              <tbody>
                {ads.map((ad, idx) => (
                  <tr
                    key={ad.id}
                    className={`border-b border-gray-200 transition-colors hover:bg-blue-50 ${
                      idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                    }`}
                  >
                    {/* Rank */}
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">{ad.rank}</td>

                    {/* Thumbnail */}
                    <td className="px-6 py-4">
                      {ad.creative?.thumbnail_url || ad.creative?.image_url ? (
                        <NextImage
                          src={ad.creative.thumbnail_url || ad.creative.image_url || ''}
                          alt={ad.name}
                          width={40}
                          height={40}
                          className="rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded bg-gray-100">
                          <ImageIcon className="h-5 w-5 text-gray-300" />
                        </div>
                      )}
                    </td>

                    {/* Ad Name */}
                    <td className="px-6 py-4">
                      <p className="max-w-xs truncate text-sm font-medium text-gray-900">
                        {ad.name}
                      </p>
                      {ad.creative?.body && (
                        <p className="line-clamp-1 text-xs text-gray-500">{ad.creative.body}</p>
                      )}
                    </td>

                    {/* Campaign Name */}
                    <td className="px-6 py-4 text-sm text-gray-700">{ad.campaign_name || '—'}</td>

                    {/* Status */}
                    <td className="px-6 py-4">
                      <StatusBadge status={ad.status} />
                    </td>

                    {/* Results - Highlighted with badge */}
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-green-700">
                        <TrendingUp className="h-4 w-4" />
                        <span className="text-sm font-bold">{formatNumber(ad.results)}</span>
                      </div>
                    </td>

                    {/* CPA */}
                    <td className="px-6 py-4 text-right text-sm font-medium text-gray-700">
                      {ad.cpa !== null ? formatCurrency(ad.cpa) : '—'}
                    </td>

                    {/* Spend */}
                    <td className="px-6 py-4 text-right text-sm font-medium text-gray-700">
                      {ad.insights?.spend ? formatCurrency(ad.insights.spend) : '—'}
                    </td>

                    {/* CTR % */}
                    <td className="px-6 py-4 text-right text-sm font-medium text-gray-700">
                      {ad.insights?.ctr ? formatPercent(ad.insights.ctr) : '—'}
                    </td>

                    {/* Clicks */}
                    <td className="px-6 py-4 text-right text-sm font-medium text-gray-700">
                      {ad.insights?.clicks ? formatNumber(ad.insights.clicks) : '—'}
                    </td>

                    {/* Impressions */}
                    <td className="px-6 py-4 text-right text-sm font-medium text-gray-700">
                      {ad.insights?.impressions ? formatNumber(ad.insights.impressions) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary */}
        {!loading && ads.length > 0 && (
          <div className="mt-6 text-sm text-gray-600">
            Showing <span className="font-semibold text-gray-900">{ads.length}</span> top performing
            ads
          </div>
        )}
      </div>
    </div>
  );
}
