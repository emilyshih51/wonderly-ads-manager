'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { DataTable } from '@/components/data/data-table';
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
import { Copy, RefreshCw, Eye, DollarSign, Target, BarChart3, Layers } from 'lucide-react';
import { StatCard } from '@/components/data/stat-card';
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

  // Summary stats
  const summary = useMemo(() => {
    const active = campaigns.filter((c) => c.status === 'ACTIVE').length;
    const paused = campaigns.filter((c) => c.status === 'PAUSED').length;
    const totalSpend = campaigns.reduce((sum, c) => sum + parseFloat(c.insights?.spend || '0'), 0);
    const totalResults = campaigns.reduce(
      (sum, c) =>
        sum + getResultCount({ actions: c.insights?.actions, campaign_id: c.id }, c.id, {}),
      0
    );

    return { active, paused, total: campaigns.length, totalSpend, totalResults };
  }, [campaigns]);

  const columns = useMemo<ColumnDef<CampaignRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tCommon('name'),
        minSize: 200,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-[var(--color-foreground)]">
              {row.original.name}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[var(--color-muted-foreground)]">
              {row.original.objective?.replace('OUTCOME_', '').replace(/_/g, ' ').toLowerCase()}
            </p>
          </div>
        ),
        enableSorting: true,
      },
      {
        accessorKey: 'status',
        header: tCommon('status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        enableSorting: true,
        size: 100,
      },
      {
        id: 'spend',
        header: tMetrics('spend'),
        accessorFn: (row) => parseFloat(row.insights?.spend || '0'),
        cell: ({ row }) => {
          const spend = parseFloat(row.original.insights?.spend || '0');

          return (
            <span className="text-[var(--color-foreground)]">
              {spend > 0 ? formatCurrency(spend) : '—'}
            </span>
          );
        },
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'results',
        header: tMetrics('results'),
        accessorFn: (row) =>
          getResultCount({ actions: row.insights?.actions, campaign_id: row.id }, row.id, {}),
        cell: ({ row }) => {
          const results = getResultCount(
            { actions: row.original.insights?.actions, campaign_id: row.original.id },
            row.original.id,
            {}
          );

          return (
            <span className="text-[var(--color-foreground)]">
              {results > 0 ? formatNumber(results) : '—'}
            </span>
          );
        },
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'ctr',
        header: tMetrics('ctr'),
        accessorFn: (row) => parseFloat(row.insights?.ctr || '0'),
        cell: ({ row }) => {
          const ctr = parseFloat(row.original.insights?.ctr || '0');

          return (
            <span className="text-[var(--color-foreground)]">
              {ctr > 0 ? formatPercent(ctr) : '—'}
            </span>
          );
        },
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'cpc',
        header: tMetrics('cpc'),
        accessorFn: (row) => parseFloat(row.insights?.cpc || '0'),
        cell: ({ row }) => {
          const cpc = parseFloat(row.original.insights?.cpc || '0');

          return (
            <span className="text-[var(--color-foreground)]">
              {cpc > 0 ? formatCurrency(cpc) : '—'}
            </span>
          );
        },
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'costPerResult',
        header: tMetrics('costPerResult'),
        accessorFn: (row) => {
          const v = getCostPerResult(
            {
              spend: row.insights?.spend || '0',
              actions: row.insights?.actions,
              campaign_id: row.id,
            },
            row.id,
            {}
          );

          return v ?? 0;
        },
        cell: ({ row }) => {
          const v = getCostPerResult(
            {
              spend: row.original.insights?.spend || '0',
              actions: row.original.insights?.actions,
              campaign_id: row.original.id,
            },
            row.original.id,
            {}
          );

          return (
            <span className="text-[var(--color-foreground)]">
              {v != null && v > 0 ? formatCurrency(v) : '—'}
            </span>
          );
        },
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'actions',
        header: '',
        size: 80,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-[var(--color-muted-foreground)]"
              onClick={(e) => {
                e.stopPropagation();
                handleViewAds(row.original);
              }}
            >
              <Eye className="h-3 w-3" />
              <span className="hidden sm:inline">{t('viewAds')}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-[var(--color-muted-foreground)]"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCampaign(row.original);
                setNewName(`${row.original.name} (Copy)`);
                setDuplicateDialogOpen(true);
              }}
            >
              <Copy className="h-3 w-3" />
              <span className="hidden sm:inline">{t('duplicate')}</span>
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- translation fns are stable
    []
  );

  return (
    <div>
      <Header title={t('title')} description={t('description')}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-8"
        >
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', isFetching && 'animate-spin')} />
          {tCommon('refresh')}
        </Button>
      </Header>

      <div className="p-4 sm:p-6 lg:p-8">
        {isLoading ? (
          <CampaignsSkeleton />
        ) : (
          <div className="space-y-5">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <StatCard
                label={tCommon('total')}
                value={summary.total.toString()}
                icon={Layers}
                accent="#6366f1"
                detail={t('activePaused', { active: summary.active, paused: summary.paused })}
              />
              <StatCard
                label={tMetrics('spend')}
                value={formatCurrency(summary.totalSpend)}
                icon={DollarSign}
                accent="#10b981"
              />
              <StatCard
                label={tMetrics('results')}
                value={formatNumber(summary.totalResults)}
                icon={Target}
                accent="#f43f5e"
              />
              <StatCard
                label={tMetrics('costPerResult')}
                value={
                  summary.totalResults > 0
                    ? formatCurrency(summary.totalSpend / summary.totalResults)
                    : '—'
                }
                icon={BarChart3}
                accent="#8b5cf6"
              />
            </div>

            {/* Table */}
            <DataTable
              columns={columns}
              data={campaigns}
              title={`${t('title')} (${campaigns.length})`}
              searchKey="name"
              searchPlaceholder={`${tCommon('search')} ${t('title').toLowerCase()}…`}
              emptyMessage={t('noCampaignsFound')}
              pagination={campaigns.length > 15}
              pageSize={15}
            />
          </div>
        )}
      </div>

      {/* Duplicate Dialog */}
      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('duplicateCampaign')}</DialogTitle>
            <DialogDescription>
              {t('duplicateDesc', { name: selectedCampaign?.name || '' })}
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
