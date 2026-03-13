'use client';

import { useEffect, useState, useCallback } from 'react';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAppStore } from '@/stores/app-store';
import { formatCurrency, formatPercent, formatNumber, getResultsFromActions, getCostPerResult } from '@/lib/utils';
import { Copy, RefreshCw } from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  insights?: {
    spend: string;
    cpm: string;
    ctr: string;
    cpc: string;
    actions?: Array<{ action_type: string; value: string }>;
    cost_per_action_type?: Array<{ action_type: string; value: string }>;
  } | null;
}

export default function CampaignsPage() {
  const { datePreset } = useAppStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [newName, setNewName] = useState('');
  const [duplicating, setDuplicating] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/meta/campaigns?with_insights=true&date_preset=${datePreset}`);
      const data = await res.json();
      setCampaigns(data.data || []);
    } catch (error) {
      console.error('Failed to fetch campaigns:', error);
    } finally {
      setLoading(false);
    }
  }, [datePreset]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleDuplicate = async () => {
    if (!selectedCampaign) return;
    setDuplicating(true);
    try {
      const res = await fetch('/api/meta/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'campaign',
          id: selectedCampaign.id,
          newName: newName || `${selectedCampaign.name} (Copy)`,
        }),
      });
      const data = await res.json();
      if (data.id) {
        setDuplicateDialogOpen(false);
        fetchCampaigns();
      }
    } catch (error) {
      console.error('Duplicate failed:', error);
    } finally {
      setDuplicating(false);
    }
  };

  return (
    <div>
      <Header title="Campaigns" description="Manage and duplicate your ad campaigns">
        <Button variant="outline" size="sm" onClick={fetchCampaigns} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </Header>

      <div className="p-8">
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Objective</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase">Spend</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase">Results</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase">CTR</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase">CPC</th>
                    <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase">Cost/Result</th>
                    <th className="text-center py-3 px-4 text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="text-center py-12 text-gray-400">Loading campaigns...</td></tr>
                  ) : campaigns.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-12 text-gray-400">No campaigns found</td></tr>
                  ) : (
                    campaigns.map((campaign) => (
                      <tr key={campaign.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-3 px-4 font-medium text-gray-900 max-w-[250px] truncate">{campaign.name}</td>
                        <td className="py-3 px-4"><StatusBadge status={campaign.status} /></td>
                        <td className="py-3 px-4 text-gray-500 text-xs">{campaign.objective?.replace('OUTCOME_', '')}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(campaign.insights?.spend)}</td>
                        <td className="py-3 px-4 text-right">{formatNumber(getResultsFromActions(campaign.insights?.actions))}</td>
                        <td className="py-3 px-4 text-right">{formatPercent(campaign.insights?.ctr)}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(campaign.insights?.cpc)}</td>
                        <td className="py-3 px-4 text-right">{formatCurrency(getCostPerResult(campaign.insights?.cost_per_action_type))}</td>
                        <td className="py-3 px-4 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedCampaign(campaign);
                              setNewName(`${campaign.name} (Copy)`);
                              setDuplicateDialogOpen(true);
                            }}
                          >
                            <Copy className="h-4 w-4 mr-1" /> Duplicate
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Duplicate Dialog */}
      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate Campaign</DialogTitle>
            <DialogDescription>
              Create a copy of &ldquo;{selectedCampaign?.name}&rdquo; with all the same settings. The copy will be created in PAUSED status.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-gray-700">New campaign name</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1" />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDuplicateDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleDuplicate} disabled={duplicating}>
                {duplicating ? 'Duplicating...' : 'Duplicate Campaign'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
