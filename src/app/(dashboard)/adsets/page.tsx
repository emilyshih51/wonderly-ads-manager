'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { StatusBadge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/app-store';
import { formatCurrency, formatNumber, CALL_TO_ACTION_TYPES } from '@/lib/utils';
import {
  Copy, RefreshCw, Plus, Upload, ChevronDown, ChevronRight,
  ImagePlus, Trash2, CheckCircle2, AlertCircle, Loader2,
  Globe, Type, Link2, FileText, MousePointer, Tag, Image,
} from 'lucide-react';

/* ---------- Types ---------- */
interface Campaign { id: string; name: string; status: string; }
interface AdSet {
  id: string; name: string; campaign_id: string;
  campaign?: { name: string }; status: string;
  daily_budget?: string; lifetime_budget?: string;
  optimization_goal?: string;
  insights?: {
    spend: string; impressions: string; clicks: string;
    cpm: string; ctr: string; cpc: string;
    actions?: Array<{ action_type: string; value: string }>;
  } | null;
}

interface QueuedAd {
  id: string; file: File; preview: string; name: string;
  message: string; headline: string; link: string; description: string;
  callToAction: string; status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

/* ---------- Component ---------- */
export default function LaunchPage() {
  const { datePreset } = useAppStore();

  /* -- Data -- */
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [expandedAdSet, setExpandedAdSet] = useState<string | null>(null);

  /* -- Unified Create mode -- */
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [createStep, setCreateStep] = useState<'source' | 'setup' | 'media'>('source');
  const [duplicateSourceId, setDuplicateSourceId] = useState<string>('');
  const [duplicateName, setDuplicateName] = useState('');
  const [duplicateTargetCampaign, setDuplicateTargetCampaign] = useState<string>('');
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState('');
  const [newlyCreatedAdSetId, setNewlyCreatedAdSetId] = useState<string>('');

  /* -- Ad setup fields (shared for all ads in the batch) -- */
  const [pageId, setPageId] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [utmMedium, setUtmMedium] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [callToAction, setCallToAction] = useState('LEARN_MORE');

  /* -- Media upload -- */
  const [adQueue, setAdQueue] = useState<QueuedAd[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* -- Per-adset queues (for inline uploads on existing ad sets) -- */
  const [inlineQueues, setInlineQueues] = useState<Record<string, QueuedAd[]>>({});
  const [inlineBulkTarget, setInlineBulkTarget] = useState<string | null>(null);
  const inlineFileRef = useRef<HTMLInputElement>(null);
  const [inlineFileTarget, setInlineFileTarget] = useState<string>('');

  /* ---------- Build final URL with UTM ---------- */
  const buildFinalUrl = () => {
    if (!websiteUrl) return '';
    try {
      const url = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
      if (utmSource) url.searchParams.set('utm_source', utmSource);
      if (utmMedium) url.searchParams.set('utm_medium', utmMedium);
      if (utmCampaign) url.searchParams.set('utm_campaign', utmCampaign);
      return url.toString();
    } catch {
      return websiteUrl;
    }
  };

  /* ---------- Fetching ---------- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      const [campaignsRes, adSetsRes] = await Promise.all([
        fetch('/api/meta/campaigns'),
        fetch('/api/meta/adsets'),
      ]);
      const campaignsData = await campaignsRes.json();
      const adSetsData = await adSetsRes.json();
      if (campaignsData.error) setFetchError(campaignsData.error);
      if (adSetsData.error) setFetchError(adSetsData.error);
      setCampaigns(campaignsData.data || []);
      setAdSets(adSetsData.data || []);
      setLoading(false);

      if ((adSetsData.data || []).length > 0) {
        try {
          const insightsRes = await fetch(`/api/meta/adsets?with_insights=true&date_preset=${datePreset}`);
          const insightsData = await insightsRes.json();
          if (insightsData.data) setAdSets(insightsData.data);
        } catch { /* insights failed — fine */ }
      }
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Failed to load data');
      setLoading(false);
    }
  }, [datePreset]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ---------- Filtering ---------- */
  const filteredAdSets = selectedCampaign === 'all'
    ? adSets : adSets.filter((a) => a.campaign_id === selectedCampaign);
  const campaignOptions = [
    { label: 'All Campaigns', value: 'all' },
    ...campaigns.map((c) => ({ label: c.name, value: c.id })),
  ];

  /* ---------- Open create panel ---------- */
  const openCreatePanel = (sourceAdSet?: AdSet) => {
    const source = sourceAdSet || adSets[0];
    setDuplicateSourceId(source?.id || '');
    setDuplicateName(source ? `${source.name} (Copy)` : '');
    setDuplicateTargetCampaign(source?.campaign_id || (selectedCampaign !== 'all' ? selectedCampaign : ''));
    setDuplicateError('');
    setCreateStep('source');
    setNewlyCreatedAdSetId('');
    setAdQueue([]);
    setShowCreatePanel(true);
  };

  /* ---------- Step 1: Duplicate ad set ---------- */
  const handleDuplicate = async () => {
    if (!duplicateSourceId || !duplicateName) return;
    setDuplicating(true);
    setDuplicateError('');
    try {
      const res = await fetch('/api/meta/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'adset', id: duplicateSourceId, newName: duplicateName,
          ...(duplicateTargetCampaign && { targetCampaignId: duplicateTargetCampaign }),
        }),
      });
      const data = await res.json();
      if (data.id) {
        setNewlyCreatedAdSetId(data.id);
        setCreateStep('setup');
        fetchData();
      } else {
        setDuplicateError(data.error || 'Duplication failed');
      }
    } catch (error) {
      setDuplicateError(error instanceof Error ? error.message : 'Duplication failed');
    } finally { setDuplicating(false); }
  };

  /* ---------- Step 3: Add media files ---------- */
  const handleMediaFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAds: QueuedAd[] = Array.from(files).map((file, i) => ({
      id: `${Date.now()}-${i}`, file, preview: URL.createObjectURL(file),
      name: file.name.replace(/\.[^.]+$/, ''),
      message: primaryText, headline, link: buildFinalUrl(),
      description, callToAction, status: 'pending' as const,
    }));
    setAdQueue((prev) => [...prev, ...newAds]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAd = (adId: string) => setAdQueue((prev) => prev.filter((a) => a.id !== adId));

  const updateAd = (adId: string, updates: Partial<QueuedAd>) =>
    setAdQueue((prev) => prev.map((a) => a.id === adId ? { ...a, ...updates } : a));

  /* ---------- Bulk Upload ---------- */
  const handleBulkUpload = async () => {
    if (adQueue.length === 0 || !pageId || !newlyCreatedAdSetId) return;
    setBulkUploading(true);
    const finalUrl = buildFinalUrl();

    for (const ad of adQueue) {
      if (ad.status === 'done') continue;
      updateAd(ad.id, { status: 'uploading' });
      try {
        const imgForm = new FormData();
        imgForm.append('action', 'upload_image');
        imgForm.append('file', ad.file);
        const imgRes = await fetch('/api/meta/upload', { method: 'POST', body: imgForm });
        const imgData = await imgRes.json();
        const images = imgData.images;
        const imageHash = images ? Object.values(images as Record<string, { hash: string }>)[0]?.hash : null;
        if (!imageHash) throw new Error('Image upload failed — no hash');

        const adForm = new FormData();
        adForm.append('action', 'create_ad');
        adForm.append('adset_id', newlyCreatedAdSetId);
        adForm.append('name', ad.name);
        adForm.append('page_id', pageId);
        adForm.append('message', ad.message || primaryText);
        adForm.append('link', ad.link || finalUrl);
        adForm.append('headline', ad.headline || headline);
        adForm.append('description', ad.description || description);
        adForm.append('call_to_action', ad.callToAction || callToAction);
        adForm.append('image_hash', imageHash);
        adForm.append('status', 'PAUSED');

        const adRes = await fetch('/api/meta/upload', { method: 'POST', body: adForm });
        const adData = await adRes.json();
        if (adData.id) { updateAd(ad.id, { status: 'done' }); }
        else { throw new Error(adData.error?.message || 'Ad creation failed'); }
      } catch (err) {
        updateAd(ad.id, { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }
    setBulkUploading(false);
  };

  /* ---------- Inline ad set upload (existing ad sets) ---------- */
  const handleInlineFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !inlineFileTarget) return;
    const newAds: QueuedAd[] = Array.from(files).map((file, i) => ({
      id: `${Date.now()}-${i}`, file, preview: URL.createObjectURL(file),
      name: file.name.replace(/\.[^.]+$/, ''),
      message: '', headline: '', link: '', description: '',
      callToAction: 'LEARN_MORE', status: 'pending' as const,
    }));
    setInlineQueues((prev) => ({
      ...prev,
      [inlineFileTarget]: [...(prev[inlineFileTarget] || []), ...newAds],
    }));
    if (inlineFileRef.current) inlineFileRef.current.value = '';
  };

  const updateInlineAd = (adSetId: string, adId: string, updates: Partial<QueuedAd>) => {
    setInlineQueues((prev) => ({
      ...prev,
      [adSetId]: (prev[adSetId] || []).map((a) => a.id === adId ? { ...a, ...updates } : a),
    }));
  };

  const removeInlineAd = (adSetId: string, adId: string) => {
    setInlineQueues((prev) => ({
      ...prev,
      [adSetId]: (prev[adSetId] || []).filter((a) => a.id !== adId),
    }));
  };

  const applyToAllInline = (adSetId: string, field: keyof QueuedAd, value: string) => {
    setInlineQueues((prev) => ({
      ...prev,
      [adSetId]: (prev[adSetId] || []).map((ad) =>
        ad.status === 'pending' ? { ...ad, [field]: value } : ad
      ),
    }));
  };

  const handleInlineBulkUpload = async (adSetId: string) => {
    const queue = inlineQueues[adSetId];
    if (!queue || queue.length === 0 || !pageId) return;
    setInlineBulkTarget(adSetId);
    for (const ad of queue) {
      if (ad.status === 'done') continue;
      updateInlineAd(adSetId, ad.id, { status: 'uploading' });
      try {
        const imgForm = new FormData();
        imgForm.append('action', 'upload_image');
        imgForm.append('file', ad.file);
        const imgRes = await fetch('/api/meta/upload', { method: 'POST', body: imgForm });
        const imgData = await imgRes.json();
        const images = imgData.images;
        const imageHash = images ? Object.values(images as Record<string, { hash: string }>)[0]?.hash : null;
        if (!imageHash) throw new Error('Image upload failed');

        const adForm = new FormData();
        adForm.append('action', 'create_ad');
        adForm.append('adset_id', adSetId);
        adForm.append('name', ad.name);
        adForm.append('page_id', pageId);
        adForm.append('message', ad.message);
        adForm.append('link', ad.link);
        adForm.append('headline', ad.headline);
        adForm.append('description', ad.description);
        adForm.append('call_to_action', ad.callToAction);
        adForm.append('image_hash', imageHash);
        adForm.append('status', 'PAUSED');

        const adRes = await fetch('/api/meta/upload', { method: 'POST', body: adForm });
        const adData = await adRes.json();
        if (adData.id) { updateInlineAd(adSetId, ad.id, { status: 'done' }); }
        else { throw new Error(adData.error?.message || 'Ad creation failed'); }
      } catch (err) {
        updateInlineAd(adSetId, ad.id, { status: 'error', error: err instanceof Error ? err.message : 'Error' });
      }
    }
    setInlineBulkTarget(null);
  };

  const getResults = (actions?: Array<{ action_type: string; value: string }>) => {
    if (!actions) return 0;
    for (const type of [
      'offsite_conversion.fb_pixel_complete_registration', 'complete_registration',
      'offsite_conversion.fb_pixel_lead', 'lead',
      'offsite_conversion.fb_pixel_purchase', 'purchase',
      'link_click', 'landing_page_view',
    ]) {
      const found = actions.find((a) => a.action_type === type);
      if (found) return parseInt(found.value);
    }
    return 0;
  };

  /* ---------- Stepper ---------- */
  const steps = [
    { key: 'source', label: 'Ad Set', icon: Copy },
    { key: 'setup', label: 'Ad Setup', icon: Type },
    { key: 'media', label: 'Media & Upload', icon: Image },
  ];

  /* ---------- Render ---------- */
  return (
    <div>
      <Header title="Launch" description="Create ad sets and upload ads">
        <div className="flex items-center gap-3">
          <SelectNative value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)} options={campaignOptions} className="w-60" />
          <Button size="sm" onClick={() => openCreatePanel()} disabled={adSets.length === 0}>
            <Plus className="h-4 w-4 mr-1" /> New Ad Set + Ads
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </Header>

      <div className="p-8 space-y-6">
        {/* Page ID (always visible) */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Facebook Page ID</label>
              <Input placeholder="Enter your Facebook Page ID for ad creatives" value={pageId} onChange={(e) => setPageId(e.target.value)} className="max-w-sm" />
              <span className="text-xs text-gray-400">Required for uploading ads</span>
            </div>
          </CardContent>
        </Card>

        {fetchError && (
          <div className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-lg">{fetchError}</div>
        )}

        {/* ===== UNIFIED CREATE PANEL ===== */}
        {showCreatePanel && (
          <Card className="border-blue-200 ring-2 ring-blue-100">
            <CardContent className="p-0">
              {/* Stepper */}
              <div className="flex items-center border-b border-gray-100 px-6 py-4">
                {steps.map((step, idx) => {
                  const StepIcon = step.icon;
                  const isActive = createStep === step.key;
                  const isDone = (step.key === 'source' && (createStep === 'setup' || createStep === 'media'))
                    || (step.key === 'setup' && createStep === 'media');
                  return (
                    <div key={step.key} className="flex items-center">
                      {idx > 0 && <div className={`w-12 h-0.5 mx-2 ${isDone || isActive ? 'bg-blue-400' : 'bg-gray-200'}`} />}
                      <button
                        onClick={() => {
                          if (isDone) setCreateStep(step.key as 'source' | 'setup' | 'media');
                        }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isActive ? 'bg-blue-600 text-white' :
                          isDone ? 'bg-blue-50 text-blue-700 cursor-pointer hover:bg-blue-100' :
                          'bg-gray-50 text-gray-400'
                        }`}
                      >
                        {isDone ? <CheckCircle2 className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                        {step.label}
                      </button>
                    </div>
                  );
                })}
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => setShowCreatePanel(false)}>
                  Close
                </Button>
              </div>

              {/* Step 1: Source Ad Set */}
              {createStep === 'source' && (
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-1.5">
                        <Copy className="h-3.5 w-3.5 text-gray-400" /> Source Ad Set
                      </label>
                      <select
                        value={duplicateSourceId}
                        onChange={(e) => {
                          setDuplicateSourceId(e.target.value);
                          const source = adSets.find((a) => a.id === e.target.value);
                          if (source) {
                            setDuplicateName(`${source.name} (Copy)`);
                            setDuplicateTargetCampaign(source.campaign_id);
                          }
                        }}
                        className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        {adSets.length === 0 && <option value="">No ad sets available</option>}
                        {adSets.map((a) => (
                          <option key={a.id} value={a.id}>{a.name} — {a.campaign?.name || 'Unknown'}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-1.5">
                        <Tag className="h-3.5 w-3.5 text-gray-400" /> New Ad Set Name
                      </label>
                      <Input value={duplicateName} onChange={(e) => setDuplicateName(e.target.value)} placeholder="Name for the duplicated ad set" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5 mb-1.5">
                        <FileText className="h-3.5 w-3.5 text-gray-400" /> Target Campaign
                      </label>
                      <select
                        value={duplicateTargetCampaign}
                        onChange={(e) => setDuplicateTargetCampaign(e.target.value)}
                        className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Same as source</option>
                        {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                      </select>
                    </div>
                  </div>
                  {duplicateError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{duplicateError}</p>}
                  <div className="flex justify-end">
                    <Button onClick={handleDuplicate} disabled={duplicating || !duplicateSourceId || !duplicateName}>
                      {duplicating ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Duplicating...</> : <>Duplicate & Continue</>}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Ad Setup */}
              {createStep === 'setup' && (
                <div className="p-6 space-y-5">
                  <div className="flex items-center gap-2 bg-green-50 text-green-700 px-4 py-2.5 rounded-lg text-sm">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    Ad set &ldquo;{duplicateName}&rdquo; created (PAUSED).
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left column: Ad content */}
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-gray-900">Ad Content</h3>
                      <div>
                        <label className="text-sm font-medium text-gray-600 flex items-center gap-1.5 mb-1">
                          <Type className="h-3.5 w-3.5" /> Primary Text
                        </label>
                        <textarea
                          rows={3}
                          value={primaryText}
                          onChange={(e) => setPrimaryText(e.target.value)}
                          className="flex w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                          placeholder="The main text that appears above your ad image..."
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600 flex items-center gap-1.5 mb-1">
                          <FileText className="h-3.5 w-3.5" /> Headline
                        </label>
                        <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Bold headline below the image" />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600 flex items-center gap-1.5 mb-1">
                          <FileText className="h-3.5 w-3.5" /> Description
                        </label>
                        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description below headline" />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600 flex items-center gap-1.5 mb-1">
                          <MousePointer className="h-3.5 w-3.5" /> Call to Action
                        </label>
                        <SelectNative
                          value={callToAction}
                          onChange={(e) => setCallToAction(e.target.value)}
                          options={CALL_TO_ACTION_TYPES.map((cta) => ({ label: cta.replace(/_/g, ' '), value: cta }))}
                        />
                      </div>
                    </div>

                    {/* Right column: Destination */}
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-gray-900">Destination</h3>
                      <div>
                        <label className="text-sm font-medium text-gray-600 flex items-center gap-1.5 mb-1">
                          <Globe className="h-3.5 w-3.5" /> Website URL
                        </label>
                        <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://your-website.com/landing-page" />
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">UTM Parameters</h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs text-gray-500 mb-0.5 block">Source</label>
                            <Input value={utmSource} onChange={(e) => setUtmSource(e.target.value)} placeholder="facebook" className="text-xs h-8" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-0.5 block">Medium</label>
                            <Input value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} placeholder="paid_social" className="text-xs h-8" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-0.5 block">Campaign</label>
                            <Input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} placeholder="spring_promo" className="text-xs h-8" />
                          </div>
                        </div>
                        {websiteUrl && (
                          <div className="flex items-center gap-1.5 mt-2">
                            <Link2 className="h-3 w-3 text-gray-400 flex-shrink-0" />
                            <p className="text-xs text-gray-500 truncate">{buildFinalUrl()}</p>
                          </div>
                        )}
                      </div>

                      {/* Ad Preview */}
                      <div className="border border-gray-200 rounded-lg p-4 bg-white">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Ad Preview</h4>
                        <div className="space-y-2">
                          <p className="text-sm text-gray-800">{primaryText || <span className="text-gray-300 italic">Primary text...</span>}</p>
                          <div className="bg-gray-100 rounded-lg h-32 flex items-center justify-center">
                            <ImagePlus className="h-8 w-8 text-gray-300" />
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <div>
                              <p className="text-xs text-gray-400 truncate">{websiteUrl || 'your-website.com'}</p>
                              <p className="text-sm font-semibold text-gray-900">{headline || <span className="text-gray-300 italic">Headline...</span>}</p>
                              {description && <p className="text-xs text-gray-500">{description}</p>}
                            </div>
                            <span className="text-xs bg-gray-100 px-2.5 py-1 rounded font-medium text-gray-600">{callToAction.replace(/_/g, ' ')}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={() => setCreateStep('media')}>
                      Continue to Media
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 3: Media & Upload */}
              {createStep === 'media' && (
                <div className="p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Upload Media</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Select images for your ads. Each image becomes one ad in the ad set.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm font-medium transition-colors">
                        <ImagePlus className="h-4 w-4" /> Select Images
                        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleMediaFiles} />
                      </label>
                    </div>
                  </div>

                  {adQueue.length === 0 ? (
                    <div className="border-2 border-dashed border-gray-200 rounded-xl py-16 text-center">
                      <ImagePlus className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500 mb-1">Drop images here or click Select Images</p>
                      <p className="text-xs text-gray-400">Supported formats: JPG, PNG, GIF, MP4</p>
                    </div>
                  ) : (
                    <>
                      {!pageId && (
                        <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                          Enter your Facebook Page ID at the top of the page before uploading.
                        </p>
                      )}
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {adQueue.map((ad) => (
                          <div key={ad.id} className={`border rounded-lg overflow-hidden bg-white transition-all ${
                            ad.status === 'done' ? 'border-green-200 bg-green-50/30'
                            : ad.status === 'error' ? 'border-red-200 bg-red-50/30'
                            : ad.status === 'uploading' ? 'border-blue-200 bg-blue-50/30'
                            : 'border-gray-200'
                          }`}>
                            <div className="relative aspect-square bg-gray-100">
                              <img src={ad.preview} alt={ad.name} className="w-full h-full object-cover" />
                              {ad.status === 'uploading' && <div className="absolute inset-0 bg-white/70 flex items-center justify-center"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>}
                              {ad.status === 'done' && <div className="absolute top-1.5 right-1.5"><CheckCircle2 className="h-5 w-5 text-green-500" /></div>}
                              {ad.status === 'error' && <div className="absolute top-1.5 right-1.5" title={ad.error}><AlertCircle className="h-5 w-5 text-red-500" /></div>}
                              {ad.status === 'pending' && <button className="absolute top-1.5 right-1.5 p-1 rounded-full bg-white/80 hover:bg-white text-gray-400 hover:text-red-500" onClick={() => removeAd(ad.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
                            </div>
                            <div className="p-2.5">
                              <Input placeholder="Ad name" value={ad.name} onChange={(e) => updateAd(ad.id, { name: e.target.value })} className="text-xs h-7" disabled={ad.status !== 'pending'} />
                              {ad.status === 'error' && ad.error && <p className="text-xs text-red-500 mt-1 truncate" title={ad.error}>{ad.error}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <p className="text-sm text-gray-500">{adQueue.length} ad{adQueue.length !== 1 ? 's' : ''} ready</p>
                        <Button onClick={handleBulkUpload} disabled={!pageId || bulkUploading || adQueue.length === 0}>
                          {bulkUploading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Uploading...</> : <><Upload className="h-4 w-4 mr-1" /> Upload All Ads</>}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ===== EXISTING AD SETS LIST ===== */}
        {loading ? (
          <Card><CardContent className="p-12 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Loading ad sets...</CardContent></Card>
        ) : filteredAdSets.length === 0 ? (
          <Card><CardContent className="p-12 text-center text-gray-400">
            {adSets.length === 0 ? 'No ad sets found in your account.' : 'No ad sets match this campaign filter.'}
          </CardContent></Card>
        ) : (
          filteredAdSets.map((adSet) => {
            const isExpanded = expandedAdSet === adSet.id;
            const queue = inlineQueues[adSet.id] || [];
            const i = adSet.insights;
            const results = getResults(i?.actions);

            return (
              <Card key={adSet.id} className={isExpanded ? 'ring-2 ring-blue-200' : ''}>
                <div className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50/50 transition-colors" onClick={() => setExpandedAdSet(isExpanded ? null : adSet.id)}>
                  <div className="flex-shrink-0 text-gray-400">
                    {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900 truncate">{adSet.name}</p>
                      <StatusBadge status={adSet.status} />
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {adSet.campaign?.name || 'Unknown campaign'} •{' '}
                      {adSet.daily_budget ? `${formatCurrency(parseFloat(adSet.daily_budget) / 100)}/day` : adSet.lifetime_budget ? `${formatCurrency(parseFloat(adSet.lifetime_budget) / 100)} lifetime` : 'No budget'}
                    </p>
                  </div>
                  {i && (
                    <div className="hidden md:flex items-center gap-6 text-xs">
                      <div className="text-center"><span className="text-gray-400 block">Spend</span><span className="font-semibold text-gray-700">{formatCurrency(i.spend)}</span></div>
                      <div className="text-center"><span className="text-gray-400 block">Results</span><span className="font-semibold text-gray-700">{formatNumber(results)}</span></div>
                      <div className="text-center"><span className="text-gray-400 block">CPC</span><span className="font-semibold text-gray-700">{formatCurrency(i.cpc)}</span></div>
                      <div className="text-center"><span className="text-gray-400 block">CPM</span><span className="font-semibold text-gray-700">{formatCurrency(i.cpm)}</span></div>
                    </div>
                  )}
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" onClick={() => openCreatePanel(adSet)}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Duplicate
                    </Button>
                    <Button variant="default" size="sm" onClick={() => { setExpandedAdSet(adSet.id); setInlineFileTarget(adSet.id); inlineFileRef.current?.click(); }}>
                      <Upload className="h-3.5 w-3.5 mr-1" /> Add Ads
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/30 p-4">
                    {queue.length === 0 ? (
                      <div className="text-center py-8">
                        <ImagePlus className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                        <p className="text-sm text-gray-500 mb-3">No ads queued for this ad set</p>
                        <Button variant="outline" size="sm" onClick={() => { setInlineFileTarget(adSet.id); inlineFileRef.current?.click(); }}>
                          <Upload className="h-4 w-4 mr-1" /> Select Images
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-700">{queue.length} ad{queue.length !== 1 ? 's' : ''} queued</p>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => { setInlineFileTarget(adSet.id); inlineFileRef.current?.click(); }}>
                              <Plus className="h-3.5 w-3.5 mr-1" /> Add More
                            </Button>
                            <Button size="sm" disabled={!pageId || inlineBulkTarget === adSet.id} onClick={() => handleInlineBulkUpload(adSet.id)}>
                              {inlineBulkTarget === adSet.id ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Uploading...</> : <><Upload className="h-3.5 w-3.5 mr-1" /> Upload All</>}
                            </Button>
                          </div>
                        </div>
                        {!pageId && <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">Enter your Facebook Page ID above before uploading.</p>}
                        {/* Bulk-apply row */}
                        <div className="bg-white border border-gray-200 rounded-lg p-3">
                          <p className="text-xs font-medium text-gray-500 mb-2">Apply to all pending ads:</p>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <Input placeholder="Primary text" className="text-xs h-8" onBlur={(e) => { if (e.target.value) applyToAllInline(adSet.id, 'message', e.target.value); }} />
                            <Input placeholder="Headline" className="text-xs h-8" onBlur={(e) => { if (e.target.value) applyToAllInline(adSet.id, 'headline', e.target.value); }} />
                            <Input placeholder="Link URL" className="text-xs h-8" onBlur={(e) => { if (e.target.value) applyToAllInline(adSet.id, 'link', e.target.value); }} />
                            <SelectNative defaultValue="LEARN_MORE" onChange={(e) => applyToAllInline(adSet.id, 'callToAction', e.target.value)} options={CALL_TO_ACTION_TYPES.map((cta) => ({ label: cta.replace(/_/g, ' '), value: cta }))} className="text-xs h-8" />
                          </div>
                        </div>
                        {/* Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          {queue.map((ad) => (
                            <div key={ad.id} className={`border rounded-lg overflow-hidden bg-white transition-all ${
                              ad.status === 'done' ? 'border-green-200 bg-green-50/30'
                              : ad.status === 'error' ? 'border-red-200 bg-red-50/30'
                              : ad.status === 'uploading' ? 'border-blue-200 bg-blue-50/30'
                              : 'border-gray-200'
                            }`}>
                              <div className="relative h-28 bg-gray-100">
                                <img src={ad.preview} alt={ad.name} className="w-full h-full object-cover" />
                                {ad.status === 'uploading' && <div className="absolute inset-0 bg-white/70 flex items-center justify-center"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>}
                                {ad.status === 'done' && <div className="absolute top-1.5 right-1.5"><CheckCircle2 className="h-5 w-5 text-green-500" /></div>}
                                {ad.status === 'error' && <div className="absolute top-1.5 right-1.5" title={ad.error}><AlertCircle className="h-5 w-5 text-red-500" /></div>}
                                {ad.status === 'pending' && <button className="absolute top-1.5 right-1.5 p-1 rounded-full bg-white/80 hover:bg-white text-gray-400 hover:text-red-500" onClick={() => removeInlineAd(adSet.id, ad.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
                              </div>
                              <div className="p-3 space-y-2">
                                <Input placeholder="Ad name" value={ad.name} onChange={(e) => updateInlineAd(adSet.id, ad.id, { name: e.target.value })} className="text-xs h-8" disabled={ad.status !== 'pending'} />
                                <Input placeholder="Primary text" value={ad.message} onChange={(e) => updateInlineAd(adSet.id, ad.id, { message: e.target.value })} className="text-xs h-8" disabled={ad.status !== 'pending'} />
                                <Input placeholder="Headline" value={ad.headline} onChange={(e) => updateInlineAd(adSet.id, ad.id, { headline: e.target.value })} className="text-xs h-8" disabled={ad.status !== 'pending'} />
                                <Input placeholder="Link URL" value={ad.link} onChange={(e) => updateInlineAd(adSet.id, ad.id, { link: e.target.value })} className="text-xs h-8" disabled={ad.status !== 'pending'} />
                                <SelectNative value={ad.callToAction} onChange={(e) => updateInlineAd(adSet.id, ad.id, { callToAction: e.target.value })} options={CALL_TO_ACTION_TYPES.map((cta) => ({ label: cta.replace(/_/g, ' '), value: cta }))} className="text-xs h-8" disabled={ad.status !== 'pending'} />
                                {ad.status === 'error' && ad.error && <p className="text-xs text-red-500 truncate" title={ad.error}>{ad.error}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* Hidden file inputs */}
      <input ref={inlineFileRef} type="file" multiple accept="image/*" className="hidden" onChange={handleInlineFiles} />
    </div>
  );
}
