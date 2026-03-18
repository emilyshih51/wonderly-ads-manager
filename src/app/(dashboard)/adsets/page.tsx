'use client';

import { useEffect, useState, useRef } from 'react';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { formatCurrency, CALL_TO_ACTION_TYPES } from '@/lib/utils';
import {
  Copy, Plus, Upload, Trash2, CheckCircle2, AlertCircle, Loader2,
  Globe, Type, FileText, Tag, Image, Search, Rocket,
} from 'lucide-react';

/* ---------- Types ---------- */
interface Campaign { id: string; name: string; status: string; }
interface AdSet { id: string; name: string; campaign_id: string; campaign?: { name: string }; status: string; }
interface SourceOption { id: string; name: string; type: 'adset' | 'campaign'; campaignName?: string; }
interface QueuedMedia { id: string; file: File; preview: string; mediaType: 'image' | 'video'; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string; }
// Keep backward compat alias
type QueuedImage = QueuedMedia;

interface LaunchState {
  sourceType: 'adset' | 'campaign' | 'existing' | null;
  sourceId: string;
  sourceName: string;
  newName: string;
  targetCampaign: string;
  primaryTexts: string[];
  headlines: string[];
  callToAction: string;
  websiteUrl: string;
  urlParameters: string;
  displayLink: string;
  pageId: string;
  dailyBudget: string;
  launchActive: boolean;
  images: QueuedImage[];
  slackMessage: string;
}

const DEFAULT_UTM_PARAMS = 'utm_source=facebook&utm_medium={{campaign.id}}&utm_campaign={{adset.id}}&utm_content={{ad.id}}&fbc_id={{adset.id}}&h_ad_id={{ad.id}}';

const INITIAL_STATE: LaunchState = {
  sourceType: null,
  sourceId: '',
  sourceName: '',
  newName: '',
  targetCampaign: '',
  primaryTexts: ['', '', '', '', ''],
  headlines: ['', '', '', '', ''],
  callToAction: 'BOOK_NOW',
  websiteUrl: 'https://www.wonderly.com',
  urlParameters: DEFAULT_UTM_PARAMS,
  displayLink: 'wonderly.com',
  pageId: process.env.NEXT_PUBLIC_FACEBOOK_PAGE_ID || '',
  dailyBudget: '',
  launchActive: false,
  images: [],
  slackMessage: '🚀 *[Wonderly]* {adset_name} launched with {budget}\n{ad_count} ads created as {status}',
};

export default function LaunchPage() {
  const [state, setState] = useState<LaunchState>(INITIAL_STATE);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [launchSuccess, setLaunchSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasDefaults, setHasDefaults] = useState(false);

  // Load saved defaults indicator on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wonderly_default_adtext');
      setHasDefaults(!!saved);
    } catch { /* ignore */ }
  }, []);

  const saveDefaults = () => {
    try {
      const defaults = {
        primaryTexts: state.primaryTexts,
        headlines: state.headlines,
      };
      localStorage.setItem('wonderly_default_adtext', JSON.stringify(defaults));
      setHasDefaults(true);
    } catch { /* ignore */ }
  };

  const loadDefaults = () => {
    try {
      const saved = localStorage.getItem('wonderly_default_adtext');
      if (!saved) return;
      const defaults = JSON.parse(saved);
      setState((prev) => ({
        ...prev,
        primaryTexts: defaults.primaryTexts || prev.primaryTexts,
        headlines: defaults.headlines || prev.headlines,
      }));
    } catch { /* ignore */ }
  };

  /* ---------- Fetch campaigns and ad sets ---------- */
  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      setFetchError('');
      try {
        const [campaignsRes, adSetsRes] = await Promise.all([
          window.fetch('/api/meta/campaigns'),
          window.fetch('/api/meta/adsets'),
        ]);
        const campaignsData = await campaignsRes.json();
        const adSetsData = await adSetsRes.json();
        setCampaigns(campaignsData.data || []);
        setAdSets(adSetsData.data || []);
      } catch (error) {
        setFetchError(error instanceof Error ? error.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  /* ---------- Build source options (filtered by search) ---------- */
  useEffect(() => {
    const options: SourceOption[] = [];
    const query = searchQuery.toLowerCase();

    if (state.sourceType === 'adset' || state.sourceType === 'existing') {
      adSets.forEach((a) => {
        if (!query || a.name.toLowerCase().includes(query)) {
          options.push({ id: a.id, name: a.name, type: 'adset', campaignName: a.campaign?.name });
        }
      });
    } else if (state.sourceType === 'campaign') {
      campaigns.forEach((c) => {
        if (!query || c.name.toLowerCase().includes(query)) {
          options.push({ id: c.id, name: c.name, type: 'campaign' });
        }
      });
    }

    setSourceOptions(options);
  }, [state.sourceType, searchQuery, campaigns, adSets]);

  /* ---------- Build final URL with URL parameters ---------- */
  const buildFinalUrl = () => {
    if (!state.websiteUrl) return '';
    try {
      const base = state.websiteUrl.startsWith('http') ? state.websiteUrl : `https://${state.websiteUrl}`;
      if (state.urlParameters) {
        const separator = base.includes('?') ? '&' : '?';
        return `${base}${separator}${state.urlParameters}`;
      }
      return base;
    } catch {
      return state.websiteUrl;
    }
  };

  /* ---------- Handle media upload (images + videos) ---------- */
  const handleMediaFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newMedia: QueuedMedia[] = Array.from(files).map((file, i) => ({
      id: `${Date.now()}-${i}`,
      file,
      preview: URL.createObjectURL(file),
      mediaType: file.type.startsWith('video/') ? 'video' as const : 'image' as const,
      status: 'pending' as const,
    }));
    setState((prev) => ({ ...prev, images: [...prev.images, ...newMedia] }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (imageId: string) => {
    setState((prev) => ({ ...prev, images: prev.images.filter((img) => img.id !== imageId) }));
  };

  const updateImage = (imageId: string, updates: Partial<QueuedImage>) => {
    setState((prev) => ({
      ...prev,
      images: prev.images.map((img) => img.id === imageId ? { ...img, ...updates } : img),
    }));
  };

  /* ---------- Get first filled text fields ---------- */
  const getFirstPrimaryText = () => state.primaryTexts.find((t) => t.trim()) || '';
  const getFirstHeadline = () => state.headlines.find((t) => t.trim()) || '';

  /* ---------- Launch ads ---------- */
  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchError('');
    setLaunchSuccess(false);

    try {
      // Validate
      if (!state.sourceId || !state.newName) {
        throw new Error('Please select a source and enter a new name');
      }
      if (state.images.length === 0) {
        throw new Error('Please upload at least one image');
      }
      if (!getFirstPrimaryText()) {
        throw new Error('Please enter at least one primary text');
      }
      if (!getFirstHeadline()) {
        throw new Error('Please enter at least one headline');
      }
      // pageId is optional — we'll resolve it from the source ad set's existing ads

      let newAdSetId: string;

      if (state.sourceType === 'existing') {
        // Adding to existing ad set — no duplication needed
        newAdSetId = state.sourceId;
      } else {
        // Step 1: Duplicate source
        const duplicateRes = await window.fetch('/api/meta/duplicate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: state.sourceType,
            id: state.sourceId,
            newName: state.newName,
            ...(state.sourceType === 'adset' && state.targetCampaign && { targetCampaignId: state.targetCampaign }),
          }),
        });
        const duplicateData = await duplicateRes.json();
        if (!duplicateData.id) {
          throw new Error(duplicateData.error || 'Failed to duplicate source');
        }

        newAdSetId = duplicateData.id;

        // If we duplicated a campaign, we need to get the ad set inside it
        if (state.sourceType === 'campaign') {
          const adSetsRes = await window.fetch(`/api/meta/adsets?campaign_id=${newAdSetId}`);
          const adSetsData = await adSetsRes.json();
          const campaignAdSets = adSetsData.data || [];
          if (campaignAdSets.length > 0) {
            newAdSetId = campaignAdSets[0].id;
          } else {
            throw new Error('Duplicated campaign has no ad sets. Please duplicate an ad set instead.');
          }
        }

        // Set daily budget on the new ad set if specified
        if (state.dailyBudget) {
          try {
            await window.fetch('/api/meta/adsets/update', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                adset_id: newAdSetId,
                adset_name: state.newName,
                daily_budget: state.dailyBudget,
              }),
            });
          } catch (e) {
            console.error('Failed to set budget:', e);
          }
        }
      }

      // Step 1c: Fetch identity (page_id + instagram_actor_id) from source ad set's existing ads
      // This ensures the new ads have the same Facebook Page + Instagram account as the originals
      let resolvedPageId = state.pageId;
      let instagramActorId = '';
      try {
        const identityRes = await window.fetch(`/api/meta/ads?adset_id=${state.sourceId}&fields=creative{object_story_spec}`);
        const identityData = await identityRes.json();
        const existingAds = identityData.data || [];
        if (existingAds.length > 0) {
          const oss = existingAds[0]?.creative?.object_story_spec;
          if (oss?.page_id) resolvedPageId = oss.page_id;
          if (oss?.instagram_actor_id) instagramActorId = oss.instagram_actor_id;
        }
      } catch (e) {
        console.error('Failed to fetch source identity, using defaults:', e);
      }

      // Step 2: Upload images and create ads
      // link = clean base URL; url_tags = tracking/UTM params (Meta appends these)
      const baseUrl = state.websiteUrl.startsWith('http') ? state.websiteUrl : `https://${state.websiteUrl}`;
      const urlTags = state.urlParameters || '';
      const primaryText = getFirstPrimaryText();
      const headline = getFirstHeadline();

      let successCount = 0;

      for (const img of state.images) {
        if (img.status === 'done') continue;
        updateImage(img.id, { status: 'uploading' });

        try {
          let imageHash: string | null = null;
          let videoId: string | null = null;

          if (img.mediaType === 'video') {
            // Upload video to Meta
            const vidForm = new FormData();
            vidForm.append('action', 'upload_video');
            vidForm.append('file', img.file);
            const vidRes = await window.fetch('/api/meta/upload', { method: 'POST', body: vidForm });
            const vidData = await vidRes.json();
            if (!vidData.id) {
              const errMsg = vidData.error?.message || vidData.error?.detail || JSON.stringify(vidData.error) || 'Video upload failed';
              throw new Error(errMsg);
            }
            videoId = vidData.id;
          } else {
            // Upload image to Meta
            const imgForm = new FormData();
            imgForm.append('action', 'upload_image');
            imgForm.append('file', img.file);
            const imgRes = await window.fetch('/api/meta/upload', { method: 'POST', body: imgForm });
            const imgData = await imgRes.json();
            imageHash = imgData.images ? Object.values(imgData.images as Record<string, { hash: string }>)[0]?.hash : null;
            if (!imageHash) {
              const errMsg = imgData.error?.message || imgData.error?.detail || JSON.stringify(imgData.error) || 'Image upload failed — no hash returned';
              throw new Error(errMsg);
            }
          }

          // Create ad — using identity (page_id + instagram) from source ad set
          const adForm = new FormData();
          adForm.append('action', 'create_ad');
          adForm.append('adset_id', newAdSetId);
          const adBaseName = state.sourceType === 'existing' ? state.sourceName : state.newName;
          adForm.append('name', `${adBaseName} - ${img.file.name.replace(/\.[^.]+$/, '')}`);
          adForm.append('page_id', resolvedPageId);
          if (instagramActorId) adForm.append('instagram_actor_id', instagramActorId);
          adForm.append('message', primaryText);
          adForm.append('link', baseUrl);
          if (urlTags) adForm.append('url_tags', urlTags);
          adForm.append('headline', headline);
          adForm.append('call_to_action', state.callToAction);
          if (imageHash) adForm.append('image_hash', imageHash);
          if (videoId) adForm.append('video_id', videoId);
          adForm.append('status', state.launchActive ? 'ACTIVE' : 'PAUSED');

          const adRes = await window.fetch('/api/meta/upload', { method: 'POST', body: adForm });
          const adData = await adRes.json();
          if (!adData.id) {
            const errObj = adData.error || {};
            const errMsg = errObj.detail || errObj.message || JSON.stringify(errObj) || 'Ad creation failed';
            throw new Error(errMsg);
          }

          updateImage(img.id, { status: 'done' });
          successCount++;
        } catch (err) {
          updateImage(img.id, { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      if (successCount > 0) {
        setLaunchSuccess(true);
        // Send Slack notification
        try {
          await window.fetch('/api/meta/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'launch',
              adset_name: state.newName,
              budget: state.dailyBudget || null,
              ad_count: successCount,
              status: state.launchActive ? 'ACTIVE' : 'PAUSED',
              custom_message: state.slackMessage || null,
            }),
          });
        } catch { /* Slack notification is best-effort */ }
      } else {
        setLaunchError('Ad set was duplicated but all ad creations failed. Check the error details on each image.');
      }
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Launch failed');
    } finally {
      setLaunching(false);
    }
  };

  /* ---------- Validation helpers ---------- */
  const canLaunch = state.sourceId && (state.sourceType === 'existing' || state.newName) && state.images.length > 0 && getFirstPrimaryText() && getFirstHeadline();
  const uploadedCount = state.images.filter((img) => img.status === 'done').length;
  const errorCount = state.images.filter((img) => img.status === 'error').length;

  return (
    <div>
      <Header title="Launch Ads" description="Create and launch new ads in seconds">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setState(INITIAL_STATE);
              setLaunchSuccess(false);
              setLaunchError('');
            }}
            variant="outline"
          >
            <Plus className="h-4 w-4 mr-1" /> New Campaign
          </Button>
        </div>
      </Header>

      <div className="p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Success message */}
          {launchSuccess && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="p-4 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-green-900">Ads launched successfully!</p>
                  <p className="text-xs text-green-700">{uploadedCount} ads created and ready to review in Meta</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Error message */}
          {launchError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-900">Error</p>
                  <p className="text-xs text-red-700">{launchError}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Fetch error */}
          {fetchError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="p-3 text-sm text-red-600">{fetchError}</CardContent>
            </Card>
          )}

          {/* SECTION 1: SOURCE (Duplicate from) */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Copy className="h-4 w-4 text-blue-600" />
                Select Source to Duplicate
              </h2>

              <div className="grid grid-cols-3 gap-4 mb-6">
                {/* Add to Existing Ad Set */}
                <button
                  onClick={() => setState((prev) => ({ ...prev, sourceType: state.sourceType === 'existing' as any ? null : 'existing' as any, sourceId: '', sourceName: '', newName: '', searchQuery: '' }))}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    state.sourceType === ('existing' as any) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-900">Add to Ad Set</p>
                  <p className="text-xs text-gray-500 mt-1">Upload new ads to an existing ad set</p>
                </button>

                {/* Duplicate Ad Set */}
                <button
                  onClick={() => setState((prev) => ({ ...prev, sourceType: state.sourceType === 'adset' ? null : 'adset', sourceId: '', sourceName: '', newName: '', searchQuery: '' }))}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    state.sourceType === 'adset' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-900">Duplicate Ad Set</p>
                  <p className="text-xs text-gray-500 mt-1">Clone and enhance an existing ad set</p>
                </button>

                {/* Duplicate Campaign */}
                <button
                  onClick={() => setState((prev) => ({ ...prev, sourceType: state.sourceType === 'campaign' ? null : 'campaign', sourceId: '', sourceName: '', newName: '', searchQuery: '' }))}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    state.sourceType === 'campaign' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-900">Duplicate Campaign</p>
                  <p className="text-xs text-gray-500 mt-1">Start from a campaign template</p>
                </button>
              </div>

              {state.sourceType && (
                <div className="space-y-4 pt-4 border-t">
                  {/* Search input */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                    <Input
                      placeholder={`Search ${state.sourceType}s...`}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>

                  {/* Source options */}
                  {sourceOptions.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">No {state.sourceType}s found</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {sourceOptions.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => {
                            setState((prev) => ({
                              ...prev,
                              sourceId: option.id,
                              sourceName: option.name,
                              newName: prev.sourceType === 'existing' ? option.name : `${option.name} (Copy)`,
                              targetCampaign: option.type === 'adset' ? (adSets.find((a) => a.id === option.id)?.campaign_id || '') : '',
                            }));
                            setSearchQuery('');
                          }}
                          className={`w-full p-3 text-left rounded-lg border transition-colors ${
                            state.sourceId === option.id
                              ? 'border-blue-400 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <p className="text-sm font-medium text-gray-900">{option.name}</p>
                          {option.campaignName && <p className="text-xs text-gray-500 mt-0.5">{option.campaignName}</p>}
                        </button>
                      ))}
                    </div>
                  )}

                  {state.sourceId && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm font-medium text-green-900">Selected: {state.sourceName}</p>
                    </div>
                  )}

                  {/* New name input (not needed for "Add to Existing") */}
                  {state.sourceId && state.sourceType !== 'existing' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                        <Tag className="h-4 w-4 text-gray-400" />
                        New Name
                      </label>
                      <Input
                        value={state.newName}
                        onChange={(e) => setState((prev) => ({ ...prev, newName: e.target.value }))}
                        placeholder="Name for the new ad set"
                      />
                    </div>
                  )}

                  {/* Target campaign (for ad set duplication) */}
                  {state.sourceType === 'adset' && state.sourceId && (
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-gray-400" />
                        Target Campaign (optional)
                      </label>
                      <select
                        value={state.targetCampaign}
                        onChange={(e) => setState((prev) => ({ ...prev, targetCampaign: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Same as source</option>
                        {campaigns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* SECTION 2: AD SETUP */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Type className="h-4 w-4 text-blue-600" />
                Ad Setup
              </h2>

              <div className="space-y-5">
                {/* Default text actions */}
                <div className="flex items-center gap-2">
                  {hasDefaults && (
                    <button
                      onClick={loadDefaults}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium px-3 py-1.5 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                      Load Saved Defaults
                    </button>
                  )}
                  <button
                    onClick={saveDefaults}
                    className="text-xs text-gray-600 hover:text-gray-700 font-medium px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {hasDefaults ? 'Update Defaults' : 'Save as Default'}
                  </button>
                </div>

                {/* Primary Texts */}
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                    <Type className="h-4 w-4 text-gray-400" />
                    Primary Text
                    <span className="text-xs text-red-500">*</span>
                  </label>
                  <div className="space-y-2">
                    {state.primaryTexts.map((text, idx) => (
                      <textarea
                        key={idx}
                        rows={2}
                        value={text}
                        onChange={(e) => {
                          const newTexts = [...state.primaryTexts];
                          newTexts[idx] = e.target.value;
                          setState((prev) => ({ ...prev, primaryTexts: newTexts }));
                        }}
                        placeholder={`Primary Text ${idx + 1}${idx === 0 ? ' (required)' : ' (optional)'}`}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Enter at least one primary text. The first filled text will be used.</p>
                </div>

                {/* Headlines */}
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-gray-400" />
                    Headline
                    <span className="text-xs text-red-500">*</span>
                  </label>
                  <div className="space-y-2">
                    {state.headlines.map((headline, idx) => (
                      <Input
                        key={idx}
                        value={headline}
                        onChange={(e) => {
                          const newHeadlines = [...state.headlines];
                          newHeadlines[idx] = e.target.value;
                          setState((prev) => ({ ...prev, headlines: newHeadlines }));
                        }}
                        placeholder={`Headline ${idx + 1}${idx === 0 ? ' (required)' : ' (optional)'}`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Enter at least one headline. The first filled headline will be used.</p>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {/* Call to Action */}
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1.5 block">Call to Action</label>
                    <SelectNative
                      value={state.callToAction}
                      onChange={(e) => setState((prev) => ({ ...prev, callToAction: e.target.value }))}
                      options={CALL_TO_ACTION_TYPES.map((cta) => ({ label: cta.replace(/_/g, ' '), value: cta }))}
                    />
                  </div>

                  {/* Facebook Page ID */}
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                      Facebook Page ID <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={state.pageId}
                      onChange={(e) => setState((prev) => ({ ...prev, pageId: e.target.value }))}
                      placeholder="Your Facebook Page ID"
                    />
                  </div>

                  {/* Daily Budget (optional) */}
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1.5 block">Daily Budget (optional)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                      <Input
                        type="number"
                        value={state.dailyBudget}
                        onChange={(e) => setState((prev) => ({ ...prev, dailyBudget: e.target.value }))}
                        placeholder="e.g. 500"
                        className="pl-7"
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Leave blank to keep source budget</p>
                  </div>
                </div>

                {/* Web Link */}
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                    <Globe className="h-4 w-4 text-gray-400" />
                    Web Link
                  </label>
                  <Input
                    value={state.websiteUrl}
                    onChange={(e) => setState((prev) => ({ ...prev, websiteUrl: e.target.value }))}
                    placeholder="https://www.wonderly.com"
                  />
                </div>

                {/* URL Parameters */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">URL Parameters</p>
                  <p className="text-xs text-gray-500 mb-3">Meta dynamic parameters like {'{{campaign.id}}'} are replaced at impression time.</p>
                  <textarea
                    rows={2}
                    value={state.urlParameters}
                    onChange={(e) => setState((prev) => ({ ...prev, urlParameters: e.target.value }))}
                    placeholder="utm_source=facebook&utm_medium={{campaign.id}}&..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none bg-white"
                  />
                  {state.websiteUrl && (
                    <div className="mt-2 p-2 bg-white rounded border border-gray-200">
                      <p className="text-xs text-gray-600 break-all">{buildFinalUrl()}</p>
                    </div>
                  )}
                </div>

                {/* Display Link */}
                <div>
                  <label className="text-xs text-gray-600 mb-1.5 block">Display Link</label>
                  <Input
                    value={state.displayLink}
                    onChange={(e) => setState((prev) => ({ ...prev, displayLink: e.target.value }))}
                    placeholder="wonderly.com"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SECTION 3: MEDIA */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Image className="h-4 w-4 text-blue-600" />
                Upload Media
              </h2>

              {state.images.length === 0 ? (
                <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors">
                  <Upload className="h-8 w-8 text-gray-400" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700">Drop images here or click to upload</p>
                    <p className="text-xs text-gray-500 mt-1">Each image becomes one ad variation</p>
                  </div>
                  <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleMediaFiles} />
                </label>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      {state.images.length} file{state.images.length !== 1 ? 's' : ''} uploaded
                      {uploadedCount > 0 && ` • ${uploadedCount} processed`}
                      {errorCount > 0 && ` • ${errorCount} failed`}
                    </p>
                    <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-xs font-medium transition-colors">
                      <Plus className="h-3.5 w-3.5" /> Add More
                      <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleMediaFiles} />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {state.images.map((img) => (
                      <div
                        key={img.id}
                        className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                          img.status === 'done'
                            ? 'border-green-300 bg-green-50'
                            : img.status === 'error'
                              ? 'border-red-300 bg-red-50'
                              : img.status === 'uploading'
                                ? 'border-blue-300 bg-blue-50'
                                : 'border-gray-300'
                        }`}
                      >
                        <div className="relative aspect-square bg-gray-100">
                          {img.mediaType === 'video' ? (
                            <video src={img.preview} className="w-full h-full object-cover" muted />
                          ) : (
                            <img src={img.preview} alt="ad" className="w-full h-full object-cover" />
                          )}
                          {img.status === 'uploading' && (
                            <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                              <Loader2 className="h-5 w-5 text-white animate-spin" />
                            </div>
                          )}
                          {img.status === 'done' && (
                            <div className="absolute top-1 left-1">
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            </div>
                          )}
                          {img.status === 'error' && (
                            <div className="absolute top-1 left-1 cursor-help" title={img.error}>
                              <AlertCircle className="h-4 w-4 text-red-600" />
                            </div>
                          )}
                          {/* Always show X to remove (except while uploading) */}
                          {img.status !== 'uploading' && (
                            <button
                              onClick={() => removeImage(img.id)}
                              className="absolute top-1 right-1 p-1 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        {img.status === 'error' && img.error && (
                          <p className="text-xs text-red-600 p-1.5 break-words whitespace-normal">{img.error}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* SECTION 4: SETTINGS */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Settings</h2>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div>
                  <p className="text-sm font-medium text-gray-900">Launch as Active</p>
                  <p className="text-xs text-gray-500 mt-0.5">Ads launch as PAUSED by default. Toggle to launch as ACTIVE.</p>
                </div>
                <button
                  onClick={() => setState((prev) => ({ ...prev, launchActive: !prev.launchActive }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    state.launchActive ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      state.launchActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Slack Notification Message */}
              <div className="mt-4">
                <label className="text-sm font-medium text-gray-700 block mb-1">Slack Notification Message</label>
                <textarea
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                  value={state.slackMessage}
                  onChange={(e) => setState((prev) => ({ ...prev, slackMessage: e.target.value }))}
                  placeholder="🚀 *[Wonderly]* {adset_name} launched with {budget}"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Variables: {'{adset_name}'} {'{budget}'} {'{ad_count}'} {'{status}'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* LAUNCH BUTTON */}
          <div className="sticky bottom-0 bg-white border-t border-gray-200 -mx-8 px-8 py-4">
            <div className="max-w-4xl mx-auto flex items-center justify-between">
              <div className="text-sm text-gray-600">
                {canLaunch ? (
                  <span className="text-green-700 font-medium">Ready to launch</span>
                ) : (
                  <span>
                    {!state.sourceId && 'Select a source • '}
                    {!state.newName && 'Enter new name • '}
                    {!state.pageId && 'Enter Page ID • '}
                    {state.images.length === 0 && 'Upload images • '}
                    {!getFirstPrimaryText() && 'Add primary text • '}
                    {!getFirstHeadline() && 'Add headline'}
                  </span>
                )}
              </div>
              <Button
                onClick={handleLaunch}
                disabled={!canLaunch || launching}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold px-8"
                size="lg"
              >
                {launching ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Launching...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4 mr-2" />
                    Launch Ads
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleMediaFiles} />
    </div>
  );
}
