'use client';

import { useEffect, useState, useCallback } from 'react';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAppStore } from '@/stores/app-store';
import { formatCurrency, formatPercent, CALL_TO_ACTION_TYPES } from '@/lib/utils';
import { Plus, RefreshCw, Upload, Image as ImageIcon } from 'lucide-react';

interface Ad {
  id: string;
  name: string;
  adset_id: string;
  status: string;
  creative?: {
    title?: string;
    body?: string;
    thumbnail_url?: string;
    image_url?: string;
  };
  insights?: {
    spend: string;
    ctr: string;
    cpc: string;
    impressions: string;
    clicks: string;
  } | null;
}

interface AdSet {
  id: string;
  name: string;
}

export default function AdsPage() {
  const { datePreset } = useAppStore();
  const [ads, setAds] = useState<Ad[]>([]);
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageHash, setImageHash] = useState('');
  const [imagePreview, setImagePreview] = useState('');

  // Form state
  const [form, setForm] = useState({
    name: '',
    adset_id: '',
    page_id: '',
    message: '',
    link: '',
    headline: '',
    description: '',
    call_to_action: 'LEARN_MORE',
  });

  const fetchAds = useCallback(async () => {
    setLoading(true);
    try {
      const [adsRes, adSetsRes] = await Promise.all([
        fetch(`/api/meta/ads?with_insights=true&date_preset=${datePreset}`),
        fetch('/api/meta/adsets'),
      ]);
      const adsData = await adsRes.json();
      const adSetsData = await adSetsRes.json();
      setAds(adsData.data || []);
      setAdSets(adSetsData.data || []);
    } catch (error) {
      console.error('Failed to fetch ads:', error);
    } finally {
      setLoading(false);
    }
  }, [datePreset]);

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    setImagePreview(URL.createObjectURL(file));

    try {
      const formData = new FormData();
      formData.append('action', 'upload_image');
      formData.append('file', file);

      const res = await fetch('/api/meta/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.images) {
        const hash = Object.values(data.images)[0] as { hash: string };
        setImageHash(hash.hash);
      }
    } catch (error) {
      console.error('Image upload failed:', error);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCreateAd = async () => {
    setCreating(true);
    try {
      const formData = new FormData();
      formData.append('action', 'create_ad');
      formData.append('name', form.name);
      formData.append('adset_id', form.adset_id);
      formData.append('page_id', form.page_id);
      formData.append('message', form.message);
      formData.append('link', form.link);
      formData.append('headline', form.headline);
      formData.append('description', form.description);
      formData.append('call_to_action', form.call_to_action);
      formData.append('status', 'PAUSED');
      if (imageHash) formData.append('image_hash', imageHash);

      const res = await fetch('/api/meta/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.id) {
        setCreateDialogOpen(false);
        setForm({ name: '', adset_id: '', page_id: '', message: '', link: '', headline: '', description: '', call_to_action: 'LEARN_MORE' });
        setImageHash('');
        setImagePreview('');
        fetchAds();
      }
    } catch (error) {
      console.error('Create ad failed:', error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <Header title="Ads" description="View ads and create new ones with image upload">
        <Button variant="outline" size="sm" onClick={fetchAds} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Ad
        </Button>
      </Header>

      <div className="p-8">
        {/* Ad Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <div className="h-48 bg-gray-100 rounded-t-xl" />
                <CardContent className="p-4 space-y-2">
                  <div className="h-4 bg-gray-100 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </CardContent>
              </Card>
            ))
          ) : ads.length === 0 ? (
            <div className="col-span-full text-center py-16 text-gray-400">
              <ImageIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="text-lg font-medium">No ads found</p>
              <p className="text-sm">Create your first ad to get started.</p>
            </div>
          ) : (
            ads.map((ad) => (
              <Card key={ad.id} className="overflow-hidden hover:shadow-md transition-shadow">
                {/* Image */}
                <div className="relative h-48 bg-gray-100 flex items-center justify-center">
                  {ad.creative?.thumbnail_url || ad.creative?.image_url ? (
                    <img
                      src={ad.creative.thumbnail_url || ad.creative.image_url}
                      alt={ad.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-gray-300" />
                  )}
                  <div className="absolute top-2 right-2">
                    <StatusBadge status={ad.status} />
                  </div>
                </div>
                <CardContent className="p-4">
                  <h3 className="font-medium text-gray-900 text-sm truncate">{ad.name}</h3>
                  {ad.creative?.body && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{ad.creative.body}</p>
                  )}
                  {ad.insights && (
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-gray-400 block">Spend</span>
                        <span className="font-medium text-gray-700">{formatCurrency(ad.insights.spend)}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 block">CTR</span>
                        <span className="font-medium text-gray-700">{formatPercent(ad.insights.ctr)}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 block">CPC</span>
                        <span className="font-medium text-gray-700">{formatCurrency(ad.insights.cpc)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Create Ad Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Ad</DialogTitle>
            <DialogDescription>Upload a creative and set up your ad copy.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {/* Image Upload */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Ad Image</label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                {imagePreview ? (
                  <div className="relative">
                    <img src={imagePreview} alt="Preview" className="max-h-48 mx-auto rounded-lg" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-0 right-0"
                      onClick={() => { setImagePreview(''); setImageHash(''); }}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                    <span className="text-sm text-gray-500">
                      {uploadingImage ? 'Uploading...' : 'Click to upload an image'}
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  </label>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Ad Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" placeholder="My Ad" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Ad Set</label>
                <SelectNative
                  value={form.adset_id}
                  onChange={(e) => setForm({ ...form, adset_id: e.target.value })}
                  options={[{ label: 'Select ad set...', value: '' }, ...adSets.map((a) => ({ label: a.name, value: a.id }))]}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Facebook Page ID</label>
              <Input value={form.page_id} onChange={(e) => setForm({ ...form, page_id: e.target.value })} className="mt-1" placeholder="Your Facebook Page ID" />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Primary Text</label>
              <textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Your ad copy text..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Headline</label>
                <Input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} className="mt-1" placeholder="Your Business Software..." />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Website URL</label>
                <Input value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} className="mt-1" placeholder="https://www.wonderly.com" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Description (optional)</label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Call to Action</label>
                <SelectNative
                  value={form.call_to_action}
                  onChange={(e) => setForm({ ...form, call_to_action: e.target.value })}
                  options={CALL_TO_ACTION_TYPES.map((cta) => ({ label: cta.replace(/_/g, ' '), value: cta }))}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateAd} disabled={creating || !form.name || !form.adset_id || !form.page_id}>
                {creating ? 'Creating...' : 'Create Ad'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
