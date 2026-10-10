'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiFetch, apiPost } from '@/lib/queries/api-fetch';
import { cn } from '@/lib/utils';
import { shortCampaignName } from '@/lib/winners-autopause';
import type { AutopauseCampaign } from '@/lib/winners-autopause-runner';
import type { AutopauseMode } from './mode-control';

const DOT: Record<AutopauseMode, string> = {
  off: 'bg-slate-400',
  dry: 'bg-amber-500',
  live: 'bg-emerald-500',
};

const MODE_LABEL: Record<AutopauseMode, string> = { off: 'Off', dry: 'Dry run', live: 'Live' };

/**
 * One tab per campaign with auto-pause rules (dot = its mode), plus "Add campaign".
 * Each campaign has its own rules, switch, results and history.
 */
export function CampaignTabs({
  campaigns,
  modes,
  selected,
  onSelect,
}: {
  campaigns: AutopauseCampaign[];
  modes: Record<string, AutopauseMode>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 md:px-8">
        {campaigns.map((c) => {
          const active = c.id === selected;
          const mode = modes[c.id] ?? 'off';

          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              title={`${c.name} — ${MODE_LABEL[mode]}`}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors',
                active
                  ? 'border-[var(--color-primary)] text-[var(--color-foreground)]'
                  : 'border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
              )}
            >
              <span className={cn('h-2 w-2 rounded-full', DOT[mode])} />
              {shortCampaignName(c.name)}
            </button>
          );
        })}
        <button
          onClick={() => setAdding(true)}
          className="flex shrink-0 items-center gap-1 px-3 py-3 text-sm font-medium whitespace-nowrap text-[var(--color-primary)] hover:underline"
        >
          <Plus className="h-4 w-4" />
          Add campaign
        </button>
      </div>

      {adding && (
        <AddCampaignDialog
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            onSelect(id);
          }}
        />
      )}
    </div>
  );
}

function AddCampaignDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['winners-autopause-available'],
    queryFn: () =>
      apiFetch<{ available: Array<{ id: string; name: string; status: string }> }>(
        '/api/winners-autopause/campaigns'
      ),
  });
  const add = useMutation({
    mutationFn: (c: { id: string; name: string }) =>
      apiPost<{ campaigns: AutopauseCampaign[] }>('/api/winners-autopause/campaigns', c),
    onSuccess: (_res, c) => {
      void queryClient.invalidateQueries({ queryKey: ['winners-autopause'] });
      void queryClient.invalidateQueries({ queryKey: ['winners-autopause-available'] });
      onAdded(c.id);
    },
  });

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();

    return (data?.available ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [data, query]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a campaign to auto-pause</DialogTitle>
          <DialogDescription>
            It starts with a copy of the Winners rules and in Dry run, so nothing is paused until
            you switch it to Live. You can change its rules separately afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search campaigns"
            className="h-9 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] pr-3 pl-9 text-sm focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none"
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-lg border border-[var(--color-border)]">
          {isLoading && (
            <p className="p-4 text-sm text-[var(--color-muted-foreground)]">Loading campaigns…</p>
          )}
          {error && <p className="p-4 text-sm text-red-500">{(error as Error).message}</p>}
          {!isLoading && !error && list.length === 0 && (
            <p className="p-4 text-sm text-[var(--color-muted-foreground)]">No campaigns found.</p>
          )}
          {list.map((c) => (
            <button
              key={c.id}
              disabled={add.isPending}
              onClick={() => add.mutate({ id: c.id, name: c.name })}
              className="flex w-full items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-[var(--color-accent)] disabled:opacity-50"
            >
              <span className="min-w-0 truncate">{c.name}</span>
              <span
                className={cn(
                  'shrink-0 text-xs',
                  c.status === 'ACTIVE'
                    ? 'text-emerald-600'
                    : 'text-[var(--color-muted-foreground)]'
                )}
              >
                {c.status === 'ACTIVE' ? 'Active' : 'Paused'}
              </span>
            </button>
          ))}
        </div>
        {add.error && <p className="text-sm text-red-500">{(add.error as Error).message}</p>}
      </DialogContent>
    </Dialog>
  );
}

/** "Remove from auto-pause" with a confirm step. Settings and history are kept. */
export function RemoveCampaignButton({
  campaign,
  onRemoved,
}: {
  campaign: AutopauseCampaign;
  onRemoved: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () =>
      apiFetch<{ campaigns: AutopauseCampaign[] }>(
        `/api/winners-autopause/campaigns?id=${encodeURIComponent(campaign.id)}`,
        { method: 'DELETE' }
      ),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['winners-autopause'] });
      onRemoved();
    },
  });

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="mr-2 h-4 w-4" />
        Remove from auto-pause
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {shortCampaignName(campaign.name)}?</DialogTitle>
            <DialogDescription>
              The daily check will stop looking at this campaign. Nothing in Meta changes, and its
              rules and history are kept if you add it back later.
            </DialogDescription>
          </DialogHeader>
          {remove.error && (
            <p className="text-sm text-red-500">{(remove.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
