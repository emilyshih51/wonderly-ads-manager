'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import NextImage from 'next/image';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { CALL_TO_ACTION_TYPES } from '@/lib/utils';
import { useCampaignList } from '@/lib/queries/meta/use-campaigns';
import { useAdSets } from '@/lib/queries/meta/use-adsets';
import {
  Copy,
  Plus,
  Upload,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Globe,
  Type,
  FileText,
  Tag,
  Image as ImageIcon,
  Search,
  Rocket,
} from 'lucide-react';
import { createLogger } from '@/services/logger';
import { useTranslations } from 'next-intl';

const logger = createLogger('AdSets');

/* ---------- Types ---------- */
interface SourceOption {
  id: string;
  name: string;
  type: 'adset' | 'campaign';
  campaignName?: string;
}
interface QueuedMedia {
  id: string;
  file: File;
  preview: string;
  mediaType: 'image' | 'video';
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}
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

const DEFAULT_UTM_PARAMS =
  'utm_source=facebook&utm_medium={{campaign.id}}&utm_campaign={{adset.id}}&utm_content={{ad.id}}&fbc_id={{adset.id}}&h_ad_id={{ad.id}}';

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
  slackMessage:
    '🚀 *[Wonderly]* {adset_name} launched with {budget}\n{ad_count} ads created as {status}',
};

export default function LaunchPage() {
  const t = useTranslations('adsets');
  const [state, setState] = useState<LaunchState>(INITIAL_STATE);
  const { data: campaigns = [] } = useCampaignList();
  const { data: adSets = [], isError: adSetsError } = useAdSets({});
  // sourceOptions is derived — computed via useMemo below
  const [searchQuery, setSearchQuery] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [launchSuccess, setLaunchSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasDefaults, setHasDefaults] = useState(false);

  // Revoke object URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      state.images.forEach((img) => {
        if (img.preview) URL.revokeObjectURL(img.preview);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load saved defaults indicator on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wonderly_default_adtext');

      setHasDefaults(!!saved);
    } catch {
      /* ignore */
    }
  }, []);

  const saveDefaults = () => {
    try {
      const defaults = {
        primaryTexts: state.primaryTexts,
        headlines: state.headlines,
      };

      localStorage.setItem('wonderly_default_adtext', JSON.stringify(defaults));
      setHasDefaults(true);
    } catch {
      /* ignore */
    }
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
    } catch {
      /* ignore */
    }
  };

  /* ---------- Sync query error to local fetchError state ---------- */
  useEffect(() => {
    if (adSetsError) setFetchError('Failed to load data');
  }, [adSetsError]);

  /* ---------- Build source options (filtered by search) ---------- */
  const sourceOptions = useMemo(() => {
    const options: SourceOption[] = [];
    const query = searchQuery.toLowerCase();

    if (state.sourceType === 'adset' || state.sourceType === 'existing') {
      adSets.forEach((a) => {
        if (!query || a.name.toLowerCase().includes(query)) {
          options.push({
            id: a.id,
            name: a.name,
            type: 'adset',
            campaignName: a.campaign?.name,
          });
        }
      });
    } else if (state.sourceType === 'campaign') {
      campaigns.forEach((c) => {
        if (!query || c.name.toLowerCase().includes(query)) {
          options.push({ id: c.id, name: c.name, type: 'campaign' });
        }
      });
    }

    return options;
  }, [state.sourceType, searchQuery, campaigns, adSets]);

  /* ---------- Build final URL with URL parameters ---------- */
  const buildFinalUrl = () => {
    if (!state.websiteUrl) return '';

    try {
      const base = state.websiteUrl.startsWith('http')
        ? state.websiteUrl
        : `https://${state.websiteUrl}`;

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
      mediaType: file.type.startsWith('video/') ? ('video' as const) : ('image' as const),
      status: 'pending' as const,
    }));

    setState((prev) => ({ ...prev, images: [...prev.images, ...newMedia] }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (imageId: string) => {
    setState((prev) => {
      const removed = prev.images.find((img) => img.id === imageId);

      if (removed?.preview) URL.revokeObjectURL(removed.preview);

      return { ...prev, images: prev.images.filter((img) => img.id !== imageId) };
    });
  };

  const updateImage = (imageId: string, updates: Partial<QueuedImage>) => {
    setState((prev) => ({
      ...prev,
      images: prev.images.map((img) => (img.id === imageId ? { ...img, ...updates } : img)),
    }));
  };

  /* ---------- Get first filled text fields ---------- */
  const getFirstPrimaryText = () => state.primaryTexts.find((t) => t.trim()) || '';
  const getFirstHeadline = () => state.headlines.find((t) => t.trim()) || '';

  /* ---------- Launch helpers ---------- */

  /** Duplicate the source ad set/campaign and return the target ad set ID. */
  const duplicateSource = async (launch: LaunchState): Promise<string> => {
    if (launch.sourceType === 'existing') {
      return launch.sourceId;
    }

    const duplicateRes = await window.fetch('/api/meta/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: launch.sourceType,
        id: launch.sourceId,
        newName: launch.newName,
        ...(launch.sourceType === 'adset' &&
          launch.targetCampaign && { targetCampaignId: launch.targetCampaign }),
      }),
    });
    const duplicateData = await duplicateRes.json();

    if (!duplicateData.id) {
      throw new Error(duplicateData.error || 'Failed to duplicate source');
    }

    let adsetId: string = duplicateData.id;

    // If we duplicated a campaign, get the ad set inside it
    if (launch.sourceType === 'campaign') {
      const adSetsRes = await window.fetch(`/api/meta/adsets?campaign_id=${adsetId}`);
      const adSetsData = await adSetsRes.json();
      const campaignAdSets = adSetsData.data || [];

      if (campaignAdSets.length > 0) {
        adsetId = campaignAdSets[0].id;
      } else {
        throw new Error('Duplicated campaign has no ad sets. Please duplicate an ad set instead.');
      }
    }

    // Set daily budget on the new ad set if specified
    if (launch.dailyBudget) {
      try {
        await window.fetch('/api/meta/adsets/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adset_id: adsetId,
            adset_name: launch.newName,
            daily_budget: launch.dailyBudget,
          }),
        });
      } catch (e) {
        logger.error('Failed to set budget', e);
      }
    }

    return adsetId;
  };

  /** Upload each media file, create a creative, and attach an ad to the ad set. Returns the number of successfully created ads. */
  const uploadMediaAndCreateAds = async (launch: LaunchState, adsetId: string): Promise<number> => {
    // Resolve identity (page_id + instagram_actor_id) from source ad set's existing ads
    let resolvedPageId = launch.pageId;
    let instagramActorId = '';

    try {
      const identityRes = await window.fetch(
        `/api/meta/ads?adset_id=${launch.sourceId}&fields=creative{object_story_spec}`
      );
      const identityData = await identityRes.json();
      const existingAds = identityData.data || [];

      if (existingAds.length > 0) {
        const oss = existingAds[0]?.creative?.object_story_spec;

        if (oss?.page_id) resolvedPageId = oss.page_id;
        if (oss?.instagram_actor_id) instagramActorId = oss.instagram_actor_id;
      }
    } catch (e) {
      logger.error('Failed to fetch source identity, using defaults', e);
    }

    const baseUrl = launch.websiteUrl.startsWith('http')
      ? launch.websiteUrl
      : `https://${launch.websiteUrl}`;
    const urlTags = launch.urlParameters || '';
    const primaryText = getFirstPrimaryText();
    const headline = getFirstHeadline();

    let successCount = 0;

    for (const img of launch.images) {
      if (img.status === 'done') continue;
      updateImage(img.id, { status: 'uploading' });

      try {
        let imageHash: string | null = null;
        let videoId: string | null = null;

        if (img.mediaType === 'video') {
          const vidForm = new FormData();

          vidForm.append('action', 'upload_video');
          vidForm.append('file', img.file);
          const vidRes = await window.fetch('/api/meta/upload', {
            method: 'POST',
            body: vidForm,
          });
          const vidData = await vidRes.json();

          if (!vidData.id) {
            const errMsg =
              vidData.error?.message ||
              vidData.error?.detail ||
              JSON.stringify(vidData.error) ||
              'Video upload failed';

            throw new Error(errMsg);
          }

          videoId = vidData.id;
        } else {
          const imgForm = new FormData();

          imgForm.append('action', 'upload_image');
          imgForm.append('file', img.file);
          const imgRes = await window.fetch('/api/meta/upload', {
            method: 'POST',
            body: imgForm,
          });
          const imgData = await imgRes.json();

          imageHash = imgData.images
            ? Object.values(imgData.images as Record<string, { hash: string }>)[0]?.hash
            : null;

          if (!imageHash) {
            const errMsg =
              imgData.error?.message ||
              imgData.error?.detail ||
              JSON.stringify(imgData.error) ||
              'Image upload failed — no hash returned';

            throw new Error(errMsg);
          }
        }

        // Create ad — using identity (page_id + instagram) from source ad set
        const adForm = new FormData();

        adForm.append('action', 'create_ad');
        adForm.append('adset_id', adsetId);
        const adBaseName = launch.sourceType === 'existing' ? launch.sourceName : launch.newName;

        adForm.append('name', `${adBaseName} - ${img.file.name.replace(/\.[^.]+$/, '')}`);
        adForm.append('page_id', resolvedPageId);
        if (instagramActorId) adForm.append('instagram_actor_id', instagramActorId);
        adForm.append('message', primaryText);
        adForm.append('link', baseUrl);
        if (urlTags) adForm.append('url_tags', urlTags);
        adForm.append('headline', headline);
        adForm.append('call_to_action', launch.callToAction);
        if (imageHash) adForm.append('image_hash', imageHash);
        if (videoId) adForm.append('video_id', videoId);
        adForm.append('status', launch.launchActive ? 'ACTIVE' : 'PAUSED');

        const adRes = await window.fetch('/api/meta/upload', {
          method: 'POST',
          body: adForm,
        });
        const adData = await adRes.json();

        if (!adData.id) {
          const errObj = adData.error || {};
          const errMsg =
            errObj.detail || errObj.message || JSON.stringify(errObj) || 'Ad creation failed';

          throw new Error(errMsg);
        }

        updateImage(img.id, { status: 'done' });
        successCount++;
      } catch (err) {
        updateImage(img.id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return successCount;
  };

  /** Send a best-effort Slack notification about the launch. */
  const notifySlack = async (
    launch: LaunchState,
    adsetId: string,
    adCount: number
  ): Promise<void> => {
    try {
      await window.fetch('/api/meta/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'launch',
          adset_name: launch.newName,
          budget: launch.dailyBudget || null,
          ad_count: adCount,
          status: launch.launchActive ? 'ACTIVE' : 'PAUSED',
          custom_message: launch.slackMessage || null,
        }),
      });
    } catch {
      /* Slack notification is best-effort */
    }
  };

  /* ---------- Launch ads (orchestrator) ---------- */
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

      const adsetId = await duplicateSource(state);
      const successCount = await uploadMediaAndCreateAds(state, adsetId);

      if (successCount > 0) {
        setLaunchSuccess(true);
        await notifySlack(state, adsetId, successCount);
      } else {
        setLaunchError(
          'Ad set was duplicated but all ad creations failed. Check the error details on each image.'
        );
      }
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Launch failed');
    } finally {
      setLaunching(false);
    }
  };

  /* ---------- Validation helpers ---------- */
  const canLaunch =
    state.sourceId &&
    (state.sourceType === 'existing' || state.newName) &&
    state.images.length > 0 &&
    getFirstPrimaryText() &&
    getFirstHeadline();
  const uploadedCount = state.images.filter((img) => img.status === 'done').length;
  const errorCount = state.images.filter((img) => img.status === 'error').length;

  return (
    <div>
      <Header title={t('title')} description={t('description')}>
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
            <Plus className="mr-1 h-4 w-4" /> New Campaign
          </Button>
        </div>
      </Header>

      <div className="p-4 sm:p-6 md:p-8">
        <div className="mx-auto max-w-4xl space-y-5">
          {/* Success message */}
          {launchSuccess && (
            <div
              className="flex items-center gap-3 rounded-xl border p-4"
              style={{ borderColor: '#22c55e30', backgroundColor: '#22c55e10' }}
            >
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" style={{ color: '#22c55e' }} />
              <div>
                <p className="text-sm font-semibold text-[var(--color-foreground)]">
                  Ads launched successfully!
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {uploadedCount} ads created and ready to review in Meta
                </p>
              </div>
            </div>
          )}

          {/* Error message */}
          {launchError && (
            <div
              className="flex items-center gap-3 rounded-xl border p-4"
              style={{ borderColor: '#ef444430', backgroundColor: '#ef444410' }}
            >
              <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: '#ef4444' }} />
              <div>
                <p className="text-sm font-semibold text-[var(--color-foreground)]">Error</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">{launchError}</p>
              </div>
            </div>
          )}

          {/* Fetch error */}
          {fetchError && (
            <div
              className="rounded-xl border p-3 text-sm"
              style={{ borderColor: '#ef444430', backgroundColor: '#ef444410', color: '#ef4444' }}
            >
              {fetchError}
            </div>
          )}

          {/* SECTION 1: SOURCE (Duplicate from) */}
          <Card>
            <CardContent className="!p-5 sm:!p-6">
              <h2 className="mb-5 flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]">
                <Copy className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                Select Source to Duplicate
              </h2>

              <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {(
                  [
                    {
                      key: 'existing' as const,
                      label: 'Add to Ad Set',
                      desc: 'Upload new ads to an existing ad set',
                    },
                    {
                      key: 'adset' as const,
                      label: 'Duplicate Ad Set',
                      desc: 'Clone and enhance an existing ad set',
                    },
                    {
                      key: 'campaign' as const,
                      label: 'Duplicate Campaign',
                      desc: 'Start from a campaign template',
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        sourceType: state.sourceType === opt.key ? null : opt.key,
                        sourceId: '',
                        sourceName: '',
                        newName: '',
                      }))
                    }
                    className="rounded-xl border-2 p-4 text-left transition-all"
                    style={
                      state.sourceType === opt.key
                        ? {
                            borderColor: 'var(--color-primary)',
                            backgroundColor:
                              'color-mix(in srgb, var(--color-primary) 8%, transparent)',
                          }
                        : { borderColor: 'var(--color-border)' }
                    }
                  >
                    <p className="text-sm font-semibold text-[var(--color-foreground)]">
                      {opt.label}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{opt.desc}</p>
                  </button>
                ))}
              </div>

              {state.sourceType && (
                <div className="space-y-4 border-t pt-4">
                  {/* Search input */}
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                    <Input
                      placeholder={`Search ${state.sourceType}s...`}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>

                  {/* Source options */}
                  {sourceOptions.length === 0 ? (
                    <p className="py-4 text-center text-sm text-[var(--color-muted-foreground)]">
                      No {state.sourceType}s found
                    </p>
                  ) : (
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {sourceOptions.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => {
                            setState((prev) => ({
                              ...prev,
                              sourceId: option.id,
                              sourceName: option.name,
                              newName:
                                prev.sourceType === 'existing'
                                  ? option.name
                                  : `${option.name} (Copy)`,
                              targetCampaign:
                                option.type === 'adset'
                                  ? adSets.find((a) => a.id === option.id)?.campaign_id || ''
                                  : '',
                            }));
                            setSearchQuery('');
                          }}
                          className="w-full rounded-lg border p-3 text-left transition-colors"
                          style={
                            state.sourceId === option.id
                              ? {
                                  borderColor: 'var(--color-primary)',
                                  backgroundColor:
                                    'color-mix(in srgb, var(--color-primary) 6%, transparent)',
                                }
                              : { borderColor: 'var(--color-border)' }
                          }
                        >
                          <p className="text-sm font-medium text-[var(--color-foreground)]">
                            {option.name}
                          </p>
                          {option.campaignName && (
                            <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                              {option.campaignName}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {state.sourceId && (
                    <div
                      className="flex items-center gap-2 rounded-lg border p-3"
                      style={{ borderColor: '#22c55e30', backgroundColor: '#22c55e10' }}
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: '#22c55e' }} />
                      <p className="text-sm font-medium text-[var(--color-foreground)]">
                        {state.sourceName}
                      </p>
                    </div>
                  )}

                  {/* New name input (not needed for "Add to Existing") */}
                  {state.sourceId && state.sourceType !== 'existing' && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--color-foreground)]">
                        <Tag className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                        New Name
                      </label>
                      <Input
                        value={state.newName}
                        onChange={(e) =>
                          setState((prev) => ({
                            ...prev,
                            newName: e.target.value,
                          }))
                        }
                        placeholder="Name for the new ad set"
                      />
                    </div>
                  )}

                  {/* Target campaign (for ad set duplication) */}
                  {state.sourceType === 'adset' && state.sourceId && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--color-foreground)]">
                        <FileText className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                        Target Campaign (optional)
                      </label>
                      <select
                        value={state.targetCampaign}
                        onChange={(e) =>
                          setState((prev) => ({
                            ...prev,
                            targetCampaign: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:border-transparent focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none"
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
            <CardContent className="!p-5 sm:!p-6">
              <h2 className="mb-5 flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]">
                <Type className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                Ad Setup
              </h2>

              <div className="space-y-6">
                {/* Default text actions */}
                <div className="flex items-center gap-2">
                  {hasDefaults && (
                    <Button variant="outline" size="sm" onClick={loadDefaults}>
                      Load Saved Defaults
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={saveDefaults}>
                    {hasDefaults ? 'Update Defaults' : 'Save as Default'}
                  </Button>
                </div>

                {/* Primary Texts */}
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-foreground)]">
                    <Type className="h-4 w-4 text-[var(--color-muted-foreground)]" />
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
                          setState((prev) => ({
                            ...prev,
                            primaryTexts: newTexts,
                          }));
                        }}
                        placeholder={`Primary Text ${idx + 1}${idx === 0 ? ' (required)' : ' (optional)'}`}
                        className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:border-transparent focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none"
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                    Enter at least one primary text. The first filled text will be used.
                  </p>
                </div>

                {/* Headlines */}
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-foreground)]">
                    <FileText className="h-4 w-4 text-[var(--color-muted-foreground)]" />
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
                          setState((prev) => ({
                            ...prev,
                            headlines: newHeadlines,
                          }));
                        }}
                        placeholder={`Headline ${idx + 1}${idx === 0 ? ' (required)' : ' (optional)'}`}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                    Enter at least one headline. The first filled headline will be used.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {/* Call to Action */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--color-foreground)]">
                      Call to Action
                    </label>
                    <SelectNative
                      value={state.callToAction}
                      onChange={(e) =>
                        setState((prev) => ({
                          ...prev,
                          callToAction: e.target.value,
                        }))
                      }
                      options={CALL_TO_ACTION_TYPES.map((cta) => ({
                        label: cta.replace(/_/g, ' '),
                        value: cta,
                      }))}
                    />
                  </div>

                  {/* Facebook Page ID */}
                  <div>
                    <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--color-foreground)]">
                      Facebook Page ID <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={state.pageId}
                      onChange={(e) =>
                        setState((prev) => ({
                          ...prev,
                          pageId: e.target.value,
                        }))
                      }
                      placeholder="Your Facebook Page ID"
                    />
                  </div>

                  {/* Daily Budget (optional) */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--color-foreground)]">
                      Daily Budget (optional)
                    </label>
                    <div className="relative">
                      <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[var(--color-muted-foreground)]">
                        $
                      </span>
                      <Input
                        type="number"
                        value={state.dailyBudget}
                        onChange={(e) =>
                          setState((prev) => ({
                            ...prev,
                            dailyBudget: e.target.value,
                          }))
                        }
                        placeholder="e.g. 500"
                        className="pl-7"
                      />
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                      Leave blank to keep source budget
                    </p>
                  </div>
                </div>

                {/* Web Link */}
                <div>
                  <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--color-foreground)]">
                    <Globe className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                    Web Link
                  </label>
                  <Input
                    value={state.websiteUrl}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        websiteUrl: e.target.value,
                      }))
                    }
                    placeholder="https://www.wonderly.com"
                  />
                </div>

                {/* URL Parameters */}
                <div className="rounded-lg bg-[var(--color-muted)] p-4">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
                    URL Parameters
                  </p>
                  <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
                    Meta dynamic parameters like {'{{campaign.id}}'} are replaced at impression
                    time.
                  </p>
                  <textarea
                    rows={2}
                    value={state.urlParameters}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        urlParameters: e.target.value,
                      }))
                    }
                    placeholder="utm_source=facebook&utm_medium={{campaign.id}}&..."
                    className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 font-mono text-xs text-[var(--color-foreground)] focus:border-transparent focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none"
                  />
                  {state.websiteUrl && (
                    <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-card)] p-2">
                      <p className="text-xs break-all text-[var(--color-muted-foreground)]">
                        {buildFinalUrl()}
                      </p>
                    </div>
                  )}
                </div>

                {/* Display Link */}
                <div>
                  <label className="mb-1.5 block text-xs text-[var(--color-muted-foreground)]">
                    Display Link
                  </label>
                  <Input
                    value={state.displayLink}
                    onChange={(e) =>
                      setState((prev) => ({
                        ...prev,
                        displayLink: e.target.value,
                      }))
                    }
                    placeholder="wonderly.com"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SECTION 3: MEDIA */}
          <Card>
            <CardContent className="!p-5 sm:!p-6">
              <h2 className="mb-5 flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]">
                <ImageIcon className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                Upload Media
              </h2>

              {state.images.length === 0 ? (
                <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-[var(--color-border)] p-8 transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-muted)]">
                  <Upload className="h-8 w-8 text-[var(--color-muted-foreground)]" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-[var(--color-foreground)]">
                      Drop images here or click to upload
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                      Each image becomes one ad variation
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={handleMediaFiles}
                  />
                </label>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      {state.images.length} file
                      {state.images.length !== 1 ? 's' : ''} uploaded
                      {uploadedCount > 0 && ` • ${uploadedCount} processed`}
                      {errorCount > 0 && ` • ${errorCount} failed`}
                    </p>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--color-primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/15">
                      <Plus className="h-3.5 w-3.5" /> Add More
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={handleMediaFiles}
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {state.images.map((img) => (
                      <div
                        key={img.id}
                        className="relative overflow-hidden rounded-lg border-2 transition-all"
                        style={
                          img.status === 'done'
                            ? { borderColor: '#22c55e50' }
                            : img.status === 'error'
                              ? { borderColor: '#ef444450' }
                              : img.status === 'uploading'
                                ? { borderColor: '#3b82f650' }
                                : { borderColor: 'var(--color-border)' }
                        }
                      >
                        <div className="relative aspect-square bg-[var(--color-muted)]">
                          {img.mediaType === 'video' ? (
                            <video src={img.preview} className="h-full w-full object-cover" muted />
                          ) : (
                            <NextImage
                              src={img.preview}
                              alt="Ad preview"
                              fill
                              sizes="120px"
                              className="object-cover"
                              unoptimized
                            />
                          )}
                          {img.status === 'uploading' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <Loader2 className="h-5 w-5 animate-spin text-white" />
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
                              className="absolute top-1 right-1 rounded-full bg-black/50 p-1 text-white transition-colors hover:bg-black/70"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        {img.status === 'error' && img.error && (
                          <p className="p-1.5 text-xs break-words whitespace-normal text-red-600">
                            {img.error}
                          </p>
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
            <CardContent className="!p-5 sm:!p-6">
              <h2 className="mb-5 text-sm font-semibold text-[var(--color-foreground)]">
                Settings
              </h2>

              <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-4">
                <div>
                  <p className="text-sm font-medium text-[var(--color-foreground)]">
                    Launch as Active
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                    Ads launch as PAUSED by default. Toggle to launch as ACTIVE.
                  </p>
                </div>
                <button
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      launchActive: !prev.launchActive,
                    }))
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    state.launchActive ? 'bg-green-500' : 'bg-[var(--color-muted-foreground)]'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-[var(--color-card)] transition-transform ${
                      state.launchActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Slack Notification Message */}
              <div className="mt-5">
                <label className="mb-1 block text-sm font-medium text-[var(--color-foreground)]">
                  Slack Notification Message
                </label>
                <textarea
                  className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none"
                  rows={3}
                  value={state.slackMessage}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      slackMessage: e.target.value,
                    }))
                  }
                  placeholder="🚀 *[Wonderly]* {adset_name} launched with {budget}"
                />
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  Variables: {'{adset_name}'} {'{budget}'} {'{ad_count}'} {'{status}'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* LAUNCH */}
          <Card>
            <CardContent className="!p-5 sm:!p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                {/* Checklist */}
                <div className="space-y-1.5">
                  {canLaunch ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: '#22c55e' }} />
                      <span className="text-sm font-medium text-[var(--color-foreground)]">
                        Ready to launch
                      </span>
                    </div>
                  ) : (
                    <>
                      {[
                        { done: !!state.sourceId, label: 'Select a source' },
                        {
                          done: state.sourceType === 'existing' || !!state.newName,
                          label: 'Enter new name',
                        },
                        { done: state.images.length > 0, label: 'Upload images' },
                        { done: !!getFirstPrimaryText(), label: 'Add primary text' },
                        { done: !!getFirstHeadline(), label: 'Add headline' },
                      ].map((step) => (
                        <div key={step.label} className="flex items-center gap-2">
                          {step.done ? (
                            <CheckCircle2
                              className="h-3.5 w-3.5 shrink-0"
                              style={{ color: '#22c55e' }}
                            />
                          ) : (
                            <div className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-[var(--color-border)]" />
                          )}
                          <span
                            className={`text-xs ${step.done ? 'text-[var(--color-muted-foreground)] line-through' : 'text-[var(--color-foreground)]'}`}
                          >
                            {step.label}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                <Button
                  onClick={handleLaunch}
                  disabled={!canLaunch || launching}
                  className="w-full sm:w-auto"
                  size="lg"
                >
                  {launching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Launching...
                    </>
                  ) : (
                    <>
                      <Rocket className="mr-2 h-4 w-4" />
                      Launch Ads
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={handleMediaFiles}
      />
    </div>
  );
}
