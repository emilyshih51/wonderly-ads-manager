'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { CampaignsSkeleton } from '@/components/skeletons/campaigns-skeleton';
import { useAppStore } from '@/stores/app-store';
import { useCampaigns, type CampaignRow } from '@/lib/queries/meta/use-campaigns';
import { apiPost } from '@/lib/queries/api-fetch';
import { queryKeys } from '@/lib/queries/keys';
import { formatCurrency, formatPercent, formatNumber, cn } from '@/lib/utils';
import { getResultCount, getCostPerResult } from '@/lib/automation-utils';
import { Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { createLogger } from '@/services/logger';
import { useTranslations } from 'next-intl';

const logger = createLogger('Campaigns');

export default function CampaignsPage() {
  const t = useTranslations('campaigns');
  const tMetrics = useTranslations('metrics');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { datePreset, setFilterCampaignId } = useAppStore();
  const { data: campaigns = [], isLoading, isFetching, refetch } = useCampaigns(datePreset);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRow | null>(null);
  const [newName, setNewName] = useState('');

  const handleViewAds = (campaign: CampaignRow) => {
    setFilterCampaignId(campaign.id);
    router.push('/ads');
  };

  const queryClient = useQueryClient();
  const duplicateMutation = useMutation({
    mutationFn: (payload: { type: string; id: string; newName: string }) =>
      apiPost('/api/meta/duplicate', payload),
    onSuccess: () => {
      setDuplicateDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.meta.campaignsBase() });
    },
    onError: (error) => logger.error('Duplicate failed', error),
  });

  const handleDuplicate = () => {
    if (!selectedCampaign) return;
    duplicateMutation.mutate({
      type: 'campaign',
      id: selectedCampaign.id,
      newName: newName || `${selectedCampaign.name} (Copy)`,
    });
  };

  return (
    <div>
      <Header title={t('title')} description={t('description')}>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin')} />
          {tCommon('refresh')}
        </Button>
      </Header>

      <div className="p-8">
        {isLoading ? (
          <CampaignsSkeleton />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]">
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tCommon('name')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tCommon('status')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        Objective
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tMetrics('spend')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tMetrics('results')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tMetrics('ctr')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tMetrics('cpc')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tMetrics('costPerResult')}
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="py-12 text-center text-[var(--color-muted-foreground)]"
                        >
                          {t('noCampaignsFound')}
                        </td>
                      </tr>
                    ) : (
                      campaigns.map((campaign) => (
                        <tr
                          key={campaign.id}
                          className="border-b border-[var(--color-border)] hover:bg-[var(--color-accent)]"
                        >
                          <td className="max-w-[250px] truncate px-4 py-3 font-medium text-[var(--color-foreground)]">
                            {campaign.name}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={campaign.status} />
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)]">
                            {campaign.objective?.replace('OUTCOME_', '')}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {formatCurrency(campaign.insights?.spend)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {/* Generic conversion fallback — see automation-utils.ts */}
                            {formatNumber(
                              getResultCount(
                                { actions: campaign.insights?.actions, campaign_id: campaign.id },
                                campaign.id,
                                {}
                              )
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {formatPercent(campaign.insights?.ctr)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {formatCurrency(campaign.insights?.cpc)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {formatCurrency(
                              getCostPerResult(
                                {
                                  spend: campaign.insights?.spend || '0',
                                  actions: campaign.insights?.actions,
                                  campaign_id: campaign.id,
                                },
                                campaign.id,
                                {}
                              )
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewAds(campaign)}
                              >
                                <ExternalLink className="mr-1 h-4 w-4" /> {t('viewAds')}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedCampaign(campaign);
                                  setNewName(`${campaign.name} (Copy)`);
                                  setDuplicateDialogOpen(true);
                                }}
                              >
                                <Copy className="mr-1 h-4 w-4" /> {t('duplicate')}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Duplicate Dialog */}
      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('duplicateCampaign')}</DialogTitle>
            <DialogDescription>
              Create a copy of &ldquo;{selectedCampaign?.name}&rdquo; with all the same settings.
              The copy will be created in PAUSED status.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-[var(--color-foreground)]">
                {t('newCampaignName')}
              </label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDuplicateDialogOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button onClick={handleDuplicate} disabled={duplicateMutation.isPending}>
                {duplicateMutation.isPending ? t('duplicating') : t('duplicateCampaign')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
