import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { metaErrorResponse } from '@/lib/meta-error-response';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:Launch');

export const maxDuration = 300; // 5 min — multiple file uploads

interface DriveFileInput {
  id: string;
  name: string;
  mimeType: string;
  isVideo: boolean;
}

interface LaunchResult {
  campaignId: string;
  adSetId: string;
  ads: Array<{ fileName: string; adId?: string; error?: string }>;
}

/**
 * POST /api/meta/launch
 *
 * Creates a full campaign from Google Drive creatives:
 * 1. Creates a campaign (or uses existing)
 * 2. Creates an ad set
 * 3. Downloads each creative from Drive
 * 4. Uploads to Meta (image or video)
 * 5. Creates an ad creative + ad for each file
 *
 * Request body:
 * - campaign_name (string)
 * - campaign_id? (string) — use existing campaign instead of creating
 * - adset_name (string)
 * - daily_budget (number, in dollars)
 * - objective (string, default: 'OUTCOME_SALES')
 * - optimization_goal (string)
 * - page_id (string) — Facebook Page ID
 * - link (string) — destination URL
 * - headline (string)
 * - primary_text (string) — body copy
 * - call_to_action (string)
 * - status ('ACTIVE' | 'PAUSED')
 * - files (DriveFileInput[]) — files to create ads from
 * - targeting? (object) — Meta targeting spec
 */
export async function POST(request: NextRequest) {
  const sessionResult = await requireSession();

  if (sessionResult instanceof NextResponse) return sessionResult;
  const session = sessionResult;

  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'Google Drive integration not configured' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const {
      campaign_name,
      campaign_id: existingCampaignId,
      adset_name,
      daily_budget,
      objective = 'OUTCOME_SALES',
      optimization_goal = 'OFFSITE_CONVERSIONS',
      page_id,
      link,
      headline,
      primary_text,
      description,
      call_to_action = 'LEARN_MORE',
      status = 'PAUSED',
      files,
      targeting,
    } = body as {
      campaign_name?: string;
      campaign_id?: string;
      adset_name: string;
      daily_budget: number;
      objective: string;
      optimization_goal: string;
      page_id: string;
      link: string;
      headline: string;
      primary_text: string;
      description?: string;
      call_to_action: string;
      status: 'ACTIVE' | 'PAUSED';
      files: DriveFileInput[];
      targeting?: Record<string, unknown>;
    };

    if (!page_id || !link || !files?.length) {
      return NextResponse.json(
        { error: 'page_id, link, and at least one file are required' },
        { status: 400 }
      );
    }

    if (!existingCampaignId && !campaign_name) {
      return NextResponse.json(
        { error: 'Either campaign_name or campaign_id is required' },
        { status: 400 }
      );
    }

    const meta = MetaService.fromSession(session);
    const accountId = session.ad_account_id;

    // 1. Create or use existing campaign
    let campaignId = existingCampaignId;

    if (!campaignId) {
      logger.info('Creating campaign', { name: campaign_name, objective });

      const campaign = (await meta.request(`/act_${accountId}/campaigns`, {
        method: 'POST',
        body: {
          name: campaign_name,
          objective,
          status,
          special_ad_categories: [],
        },
      })) as { id: string };

      campaignId = campaign.id;
      logger.info('Campaign created', { campaignId });
    }

    // 2. Create ad set
    const targetingSpec = targeting || {
      geo_locations: { countries: ['US'] },
      age_min: 18,
      age_max: 65,
    };

    logger.info('Creating ad set', { name: adset_name, campaignId });

    const adSet = (await meta.request(`/act_${accountId}/adsets`, {
      method: 'POST',
      body: {
        name: adset_name || `${campaign_name} Ad Set`,
        campaign_id: campaignId,
        status,
        optimization_goal,
        billing_event: 'IMPRESSIONS',
        daily_budget: Math.round(daily_budget * 100), // dollars → cents
        targeting: targetingSpec,
      },
    })) as { id: string };

    logger.info('Ad set created', { adSetId: adSet.id });

    // 3. For each creative file: download from Drive → upload to Meta → create ad
    const adResults: LaunchResult['ads'] = [];

    for (const file of files) {
      try {
        logger.info('Processing creative', { name: file.name, mimeType: file.mimeType });

        // Download from Google Drive
        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKey}`;
        const downloadRes = await fetch(downloadUrl, { cache: 'no-store' });

        if (!downloadRes.ok) {
          adResults.push({ fileName: file.name, error: `Download failed: ${downloadRes.status}` });
          continue;
        }

        const fileBuffer = await downloadRes.arrayBuffer();
        const uploadFile = new File([fileBuffer], file.name, { type: file.mimeType });

        // Upload to Meta
        let imageHash: string | undefined;
        let videoId: string | undefined;

        if (file.isVideo) {
          const videoResult = await meta.uploadAdVideo(uploadFile);

          videoId = videoResult.id;
          logger.info('Video uploaded', { videoId, name: file.name });
        } else {
          const imageResult = await meta.uploadAdImage(uploadFile);
          const images = imageResult.images || {};
          const firstImage = Object.values(images)[0];

          imageHash = firstImage?.hash;
          logger.info('Image uploaded', { imageHash, name: file.name });
        }

        // Create ad creative
        const adName = file.name.replace(/\.[^.]+$/, ''); // strip extension
        const objectStorySpec: Record<string, unknown> = { page_id };

        if (videoId) {
          const videoData: Record<string, unknown> = {
            video_id: videoId,
            call_to_action: { type: call_to_action, value: { link } },
          };

          if (primary_text) videoData.message = primary_text;
          if (headline) videoData.title = headline;
          if (description) videoData.link_description = description;
          objectStorySpec.video_data = videoData;
        } else {
          const linkData: Record<string, unknown> = {
            link,
            call_to_action: { type: call_to_action },
          };

          if (primary_text) linkData.message = primary_text;
          if (headline) linkData.name = headline;
          if (description) linkData.description = description;
          if (imageHash) linkData.image_hash = imageHash;
          objectStorySpec.link_data = linkData;
        }

        const creative = (await meta.request(`/act_${accountId}/adcreatives`, {
          method: 'POST',
          body: {
            name: `${adName} Creative`,
            object_story_spec: objectStorySpec,
          },
        })) as { id: string };

        // Create ad
        const ad = (await meta.request(`/act_${accountId}/ads`, {
          method: 'POST',
          body: {
            name: adName,
            adset_id: adSet.id,
            creative: { creative_id: creative.id },
            status,
          },
        })) as { id: string };

        adResults.push({ fileName: file.name, adId: ad.id });
        logger.info('Ad created', { adId: ad.id, name: file.name });
      } catch (fileError) {
        logger.error('Failed to process creative', { name: file.name, error: fileError });
        adResults.push({
          fileName: file.name,
          error: fileError instanceof Error ? fileError.message : 'Unknown error',
        });
      }
    }

    const result: LaunchResult = {
      campaignId: campaignId!,
      adSetId: adSet.id,
      ads: adResults,
    };

    logger.info('Launch complete', {
      campaignId: result.campaignId,
      totalAds: adResults.length,
      succeeded: adResults.filter((a) => a.adId).length,
      failed: adResults.filter((a) => a.error).length,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error('Launch error', error);

    return metaErrorResponse(error, 'Failed to launch campaign');
  }
}
