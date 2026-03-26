'use client';

import { useState, useMemo } from 'react';
import NextImage from 'next/image';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/dropdown';
import { CALL_TO_ACTION_TYPES } from '@/lib/utils';
import {
  FolderOpen,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Rocket,
  Globe,
  Type,
  FileText,
  Play,
  Image as ImageIcon,
  Settings2,
} from 'lucide-react';
import { createLogger } from '@/services/logger';
import { useTranslations } from 'next-intl';

const logger = createLogger('Launch:Drive');

/* ---------- Types ---------- */

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  thumbnailLink: string | null;
  isVideo: boolean;
}

interface AdResult {
  fileName: string;
  adId?: string;
  error?: string;
}

interface LaunchResult {
  campaignId: string;
  adSetId: string;
  ads: AdResult[];
}

/* ---------- Objective options ---------- */

const OBJECTIVE_OPTIONS = [
  { label: 'Sales (Conversions)', value: 'OUTCOME_SALES' },
  { label: 'Leads', value: 'OUTCOME_LEADS' },
  { label: 'Traffic', value: 'OUTCOME_TRAFFIC' },
  { label: 'Engagement', value: 'OUTCOME_ENGAGEMENT' },
  { label: 'Awareness', value: 'OUTCOME_AWARENESS' },
];

const OPTIMIZATION_GOALS: Record<string, { label: string; value: string }[]> = {
  OUTCOME_SALES: [
    { label: 'Conversions', value: 'OFFSITE_CONVERSIONS' },
    { label: 'Value', value: 'VALUE' },
  ],
  OUTCOME_LEADS: [
    { label: 'Leads', value: 'LEAD_GENERATION' },
    { label: 'Conversions', value: 'OFFSITE_CONVERSIONS' },
  ],
  OUTCOME_TRAFFIC: [
    { label: 'Link Clicks', value: 'LINK_CLICKS' },
    { label: 'Landing Page Views', value: 'LANDING_PAGE_VIEWS' },
  ],
  OUTCOME_ENGAGEMENT: [
    { label: 'Post Engagement', value: 'POST_ENGAGEMENT' },
    { label: 'Impressions', value: 'IMPRESSIONS' },
  ],
  OUTCOME_AWARENESS: [
    { label: 'Reach', value: 'REACH' },
    { label: 'Impressions', value: 'IMPRESSIONS' },
  ],
};

/* ---------- Helpers ---------- */

/** Extract Google Drive folder ID from a URL or plain ID string. */
function parseFolderId(input: string): string | null {
  const trimmed = input.trim();

  if (!trimmed) return null;

  // Direct folder URL: https://drive.google.com/drive/folders/<ID>?...
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);

  if (folderMatch) return folderMatch[1];

  // Open URL: https://drive.google.com/open?id=<ID>
  const openMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);

  if (openMatch) return openMatch[1];

  // Plain folder ID (alphanumeric, hyphens, underscores)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;

  return null;
}

/** Format file size in human-readable form. */
function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ---------- Component ---------- */

export default function DriveLaunchPage() {
  const t = useTranslations('launch');
  const tCommon = useTranslations('common');

  // Google Drive state
  const [folderUrl, setFolderUrl] = useState('');
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [driveError, setDriveError] = useState('');

  // Campaign settings
  const [campaignName, setCampaignName] = useState('');
  const [adsetName, setAdsetName] = useState('');
  const [objective, setObjective] = useState('OUTCOME_SALES');
  const [optimizationGoal, setOptimizationGoal] = useState('OFFSITE_CONVERSIONS');
  const [dailyBudget, setDailyBudget] = useState('');
  const [pageId, setPageId] = useState(process.env.NEXT_PUBLIC_FACEBOOK_PAGE_ID || '');

  // Ad copy
  const [primaryText, setPrimaryText] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [callToAction, setCallToAction] = useState('LEARN_MORE');
  const [websiteUrl, setWebsiteUrl] = useState('https://www.wonderly.com');

  // Launch state
  const [launchActive, setLaunchActive] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);

  /* ---------- Derived ---------- */

  const selectedFiles = useMemo(
    () => driveFiles.filter((f) => selectedFileIds.has(f.id)),
    [driveFiles, selectedFileIds]
  );

  const optimGoals = OPTIMIZATION_GOALS[objective] || [];

  const canLaunch =
    selectedFiles.length > 0 &&
    campaignName.trim() &&
    pageId.trim() &&
    websiteUrl.trim() &&
    primaryText.trim() &&
    headline.trim() &&
    dailyBudget.trim();

  /* ---------- Load Drive files ---------- */

  const loadDriveFiles = async () => {
    const folderId = parseFolderId(folderUrl);

    if (!folderId) {
      setDriveError(t('invalidFolderUrl'));

      return;
    }

    setLoadingFiles(true);
    setDriveError('');
    setDriveFiles([]);
    setSelectedFileIds(new Set());

    try {
      const res = await fetch(`/api/google-drive?folder_id=${encodeURIComponent(folderId)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || t('failedToLoadFolder'));
      }

      const files: DriveFile[] = data.files || [];

      setDriveFiles(files);

      // Auto-select all files
      setSelectedFileIds(new Set(files.map((f) => f.id)));

      logger.info('Drive files loaded', { folderId, count: files.length });
    } catch (err) {
      logger.error('Drive load error', err);
      setDriveError(err instanceof Error ? err.message : t('failedToLoadFolder'));
    } finally {
      setLoadingFiles(false);
    }
  };

  /* ---------- Toggle file selection ---------- */

  const toggleFile = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);

      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }

      return next;
    });
  };

  const toggleAll = () => {
    if (selectedFileIds.size === driveFiles.length) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(driveFiles.map((f) => f.id)));
    }
  };

  /* ---------- Launch campaign ---------- */

  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchError('');
    setLaunchResult(null);

    try {
      const files = selectedFiles.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        isVideo: f.isVideo,
      }));

      const body = {
        campaign_name: campaignName.trim(),
        adset_name: adsetName.trim() || `${campaignName.trim()} Ad Set`,
        daily_budget: parseFloat(dailyBudget),
        objective,
        optimization_goal: optimizationGoal,
        page_id: pageId.trim(),
        link: websiteUrl.trim(),
        headline: headline.trim(),
        primary_text: primaryText.trim(),
        description: description.trim() || undefined,
        call_to_action: callToAction,
        status: launchActive ? 'ACTIVE' : 'PAUSED',
        files,
      };

      const res = await fetch('/api/meta/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || t('launchFailed'));
      }

      setLaunchResult(data as LaunchResult);
      logger.info('Launch complete', data);
    } catch (err) {
      logger.error('Launch error', err);
      setLaunchError(err instanceof Error ? err.message : t('launchFailed'));
    } finally {
      setLaunching(false);
    }
  };

  /* ---------- Reset ---------- */

  const handleReset = () => {
    setFolderUrl('');
    setDriveFiles([]);
    setSelectedFileIds(new Set());
    setDriveError('');
    setCampaignName('');
    setAdsetName('');
    setDailyBudget('');
    setPrimaryText('');
    setHeadline('');
    setDescription('');
    setLaunchError('');
    setLaunchResult(null);
  };

  /* ---------- Render ---------- */

  const successCount = launchResult?.ads.filter((a) => a.adId).length ?? 0;
  const failedCount = launchResult?.ads.filter((a) => a.error).length ?? 0;

  return (
    <div>
      <Header title={t('title')} description={t('description')}>
        <Button size="sm" onClick={handleReset} variant="outline">
          {t('newLaunch')}
        </Button>
      </Header>

      <div className="p-4 sm:p-6 md:p-8">
        <div className="mx-auto max-w-4xl space-y-5">
          {/* Success banner */}
          {launchResult && successCount > 0 && (
            <div
              className="flex items-center gap-3 rounded-xl border p-4"
              style={{ borderColor: '#22c55e30', backgroundColor: '#22c55e10' }}
            >
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" style={{ color: '#22c55e' }} />
              <div>
                <p className="text-sm font-semibold text-[var(--color-foreground)]">
                  {t('campaignCreatedSuccess')}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {t('adsCreatedCount', { success: successCount, total: launchResult.ads.length })}
                  {failedCount > 0 && ` · ${t('adsFailed', { count: failedCount })}`}
                </p>
              </div>
            </div>
          )}

          {/* Error banner */}
          {launchError && (
            <div
              className="flex items-center gap-3 rounded-xl border p-4"
              style={{ borderColor: '#ef444430', backgroundColor: '#ef444410' }}
            >
              <AlertCircle className="h-5 w-5 flex-shrink-0" style={{ color: '#ef4444' }} />
              <div>
                <p className="text-sm font-semibold text-[var(--color-foreground)]">
                  {tCommon('error')}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">{launchError}</p>
              </div>
            </div>
          )}

          {/* SECTION 1: GOOGLE DRIVE FOLDER */}
          <Card>
            <CardContent className="!p-5 sm:!p-6">
              <h2 className="mb-5 flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]">
                <FolderOpen className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                {t('driveFolder')}
              </h2>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={folderUrl}
                  onChange={(e) => setFolderUrl(e.target.value)}
                  placeholder={t('driveFolderPlaceholder')}
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') loadDriveFiles();
                  }}
                />
                <Button
                  onClick={loadDriveFiles}
                  disabled={loadingFiles || !folderUrl.trim()}
                  className="w-full sm:w-auto"
                >
                  {loadingFiles ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FolderOpen className="mr-2 h-4 w-4" />
                  )}
                  {t('loadFiles')}
                </Button>
              </div>

              <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                {t('driveFolderHelp')}
              </p>

              {driveError && (
                <div
                  className="mt-3 rounded-lg border p-3 text-sm"
                  style={{
                    borderColor: '#ef444430',
                    backgroundColor: '#ef444410',
                    color: '#ef4444',
                  }}
                >
                  {driveError}
                </div>
              )}

              {/* File grid */}
              {driveFiles.length > 0 && (
                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      {t('filesFound', { count: driveFiles.length })}
                      {selectedFileIds.size > 0 &&
                        selectedFileIds.size < driveFiles.length &&
                        ` · ${t('filesSelected', { count: selectedFileIds.size })}`}
                    </p>
                    <Button variant="ghost" size="sm" onClick={toggleAll}>
                      {selectedFileIds.size === driveFiles.length
                        ? t('deselectAll')
                        : t('selectAll')}
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {driveFiles.map((file) => {
                      const isSelected = selectedFileIds.has(file.id);

                      return (
                        <button
                          key={file.id}
                          onClick={() => toggleFile(file.id)}
                          className="relative overflow-hidden rounded-lg border-2 text-left transition-all"
                          style={
                            isSelected
                              ? {
                                  borderColor: 'var(--color-primary)',
                                  backgroundColor:
                                    'color-mix(in srgb, var(--color-primary) 6%, transparent)',
                                }
                              : { borderColor: 'var(--color-border)', opacity: 0.6 }
                          }
                        >
                          <div className="relative aspect-square bg-[var(--color-muted)]">
                            {file.thumbnailLink ? (
                              <NextImage
                                src={file.thumbnailLink}
                                alt={file.name}
                                fill
                                sizes="120px"
                                className="object-cover"
                                unoptimized
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center">
                                {file.isVideo ? (
                                  <Play className="h-8 w-8 text-[var(--color-muted-foreground)]" />
                                ) : (
                                  <ImageIcon className="h-8 w-8 text-[var(--color-muted-foreground)]" />
                                )}
                              </div>
                            )}
                            {file.isVideo && file.thumbnailLink && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="rounded-full bg-black/50 p-2">
                                  <Play className="h-4 w-4 text-white" />
                                </div>
                              </div>
                            )}
                            {isSelected && (
                              <div className="absolute top-1.5 right-1.5">
                                <CheckCircle2 className="h-5 w-5 text-blue-600 drop-shadow" />
                              </div>
                            )}
                          </div>
                          <div className="p-1.5">
                            <p className="truncate text-xs font-medium text-[var(--color-foreground)]">
                              {file.name}
                            </p>
                            {file.size && (
                              <p className="text-xs text-[var(--color-muted-foreground)]">
                                {formatSize(file.size)}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* SECTION 2: CAMPAIGN SETTINGS */}
          <Card>
            <CardContent className="!p-5 sm:!p-6">
              <h2 className="mb-5 flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]">
                <Settings2 className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                {t('campaignSettings')}
              </h2>

              <div className="space-y-4">
                {/* Campaign name */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--color-foreground)]">
                    {t('campaignName')} <span className="text-xs text-red-500">*</span>
                  </label>
                  <Input
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder={t('campaignNamePlaceholder')}
                  />
                </div>

                {/* Ad set name */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--color-foreground)]">
                    {t('adsetName')}
                  </label>
                  <Input
                    value={adsetName}
                    onChange={(e) => setAdsetName(e.target.value)}
                    placeholder={t('adsetNamePlaceholder')}
                  />
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    {t('adsetNameHelp')}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {/* Objective */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--color-foreground)]">
                      {t('objective')}
                    </label>
                    <Select
                      value={objective}
                      onChange={(value) => {
                        setObjective(value);
                        const goals = OPTIMIZATION_GOALS[value] || [];

                        if (goals.length > 0) setOptimizationGoal(goals[0].value);
                      }}
                      options={OBJECTIVE_OPTIONS}
                      className="w-full"
                    />
                  </div>

                  {/* Optimization goal */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--color-foreground)]">
                      {t('optimizationGoal')}
                    </label>
                    <Select
                      value={optimizationGoal}
                      onChange={(value) => setOptimizationGoal(value)}
                      options={optimGoals}
                      className="w-full"
                    />
                  </div>

                  {/* Daily budget */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--color-foreground)]">
                      {t('dailyBudget')} <span className="text-xs text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[var(--color-muted-foreground)]">
                        $
                      </span>
                      <Input
                        type="number"
                        value={dailyBudget}
                        onChange={(e) => setDailyBudget(e.target.value)}
                        placeholder="e.g. 500"
                        className="pl-7"
                      />
                    </div>
                  </div>
                </div>

                {/* Facebook Page ID */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--color-foreground)]">
                    {t('facebookPageId')} <span className="text-xs text-red-500">*</span>
                  </label>
                  <Input
                    value={pageId}
                    onChange={(e) => setPageId(e.target.value)}
                    placeholder={t('facebookPageIdPlaceholder')}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SECTION 3: AD COPY */}
          <Card>
            <CardContent className="!p-5 sm:!p-6">
              <h2 className="mb-5 flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]">
                <Type className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                {t('adCopy')}
              </h2>

              <div className="space-y-4">
                {/* Primary Text */}
                <div>
                  <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--color-foreground)]">
                    <Type className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                    {t('primaryText')} <span className="text-xs text-red-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={primaryText}
                    onChange={(e) => setPrimaryText(e.target.value)}
                    placeholder={t('primaryTextPlaceholder')}
                    className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:border-transparent focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none"
                  />
                </div>

                {/* Headline */}
                <div>
                  <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--color-foreground)]">
                    <FileText className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                    {t('headline')} <span className="text-xs text-red-500">*</span>
                  </label>
                  <Input
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    placeholder={t('headlinePlaceholder')}
                  />
                </div>

                {/* Description (optional) */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--color-foreground)]">
                    {t('descriptionLabel')}
                  </label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('descriptionPlaceholder')}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Call to Action */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--color-foreground)]">
                      {t('callToAction')}
                    </label>
                    <Select
                      value={callToAction}
                      onChange={(value) => setCallToAction(value)}
                      options={CALL_TO_ACTION_TYPES.map((cta) => ({
                        label: cta.replace(/_/g, ' '),
                        value: cta,
                      }))}
                      className="w-full"
                    />
                  </div>

                  {/* Website URL */}
                  <div>
                    <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--color-foreground)]">
                      <Globe className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                      {t('websiteUrl')} <span className="text-xs text-red-500">*</span>
                    </label>
                    <Input
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://www.wonderly.com"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SECTION 4: SETTINGS & LAUNCH */}
          <Card>
            <CardContent className="!p-5 sm:!p-6">
              {/* Launch as Active toggle */}
              <div className="mb-5 flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-4">
                <div>
                  <p className="text-sm font-medium text-[var(--color-foreground)]">
                    {t('launchAsActive')}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                    {t('launchAsActiveDesc')}
                  </p>
                </div>
                <button
                  onClick={() => setLaunchActive(!launchActive)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    launchActive ? 'bg-green-500' : 'bg-[var(--color-muted-foreground)]'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-[var(--color-card)] transition-transform ${
                      launchActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Checklist + Launch button */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1.5">
                  {canLaunch ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: '#22c55e' }} />
                      <span className="text-sm font-medium text-[var(--color-foreground)]">
                        {t('readyToLaunch')}
                      </span>
                    </div>
                  ) : (
                    <>
                      {[
                        { done: selectedFiles.length > 0, label: t('checkSelectFiles') },
                        { done: !!campaignName.trim(), label: t('checkCampaignName') },
                        { done: !!dailyBudget.trim(), label: t('checkBudget') },
                        { done: !!pageId.trim(), label: t('checkPageId') },
                        { done: !!primaryText.trim(), label: t('checkPrimaryText') },
                        { done: !!headline.trim(), label: t('checkHeadline') },
                        { done: !!websiteUrl.trim(), label: t('checkWebsiteUrl') },
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
                      {t('launching')}
                    </>
                  ) : (
                    <>
                      <Rocket className="mr-2 h-4 w-4" />
                      {t('createCampaign')}
                    </>
                  )}
                </Button>
              </div>

              {/* Per-file results */}
              {launchResult && (
                <div className="mt-5 space-y-2 border-t pt-4">
                  <p className="text-xs font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
                    {t('results')}
                  </p>
                  {launchResult.ads.map((ad, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] p-2.5"
                    >
                      {ad.adId ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-[var(--color-foreground)]">
                          {ad.fileName}
                        </p>
                        {ad.error && <p className="truncate text-xs text-red-500">{ad.error}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
