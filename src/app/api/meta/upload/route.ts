import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:Upload');

export const maxDuration = 60;

/**
 * POST /api/meta/upload
 *
 * Multipart form handler for Meta ad creation. Dispatches on the `action` field:
 * - `upload_image` — Uploads an image to adimages and returns the image hash.
 * - `upload_video` — Uploads a video to advideos and returns the video ID.
 * - `create_ad` — Creates an ad creative (image or video) and then an ad.
 *
 * Maximum serverless duration: 60 seconds (video uploads can be large).
 */
export async function POST(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  try {
    const formData = await request.formData();
    const action = formData.get('action') as string;

    const meta = MetaService.fromSession(session);

    if (action === 'upload_image') {
      const file = formData.get('file') as File;

      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

      const bytes = await file.arrayBuffer();
      const uploadFile = new File([bytes], file.name, { type: file.type });

      const data = await meta.uploadAdImage(uploadFile);

      return NextResponse.json(data);
    }

    if (action === 'upload_video') {
      const file = formData.get('file') as File;

      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

      const bytes = await file.arrayBuffer();
      const uploadFile = new File([bytes], file.name, { type: file.type });

      const data = await meta.uploadAdVideo(uploadFile);

      return NextResponse.json(data);
    }

    if (action === 'create_ad') {
      const adsetId = formData.get('adset_id') as string;
      const name = formData.get('name') as string;
      const pageId = formData.get('page_id') as string;
      const link = formData.get('link') as string;

      if (!adsetId || !name || !pageId || !link) {
        return NextResponse.json(
          { error: 'adset_id, name, page_id, and link are required' },
          { status: 400 }
        );
      }

      const instagramActorId = formData.get('instagram_actor_id') as string;
      const message = formData.get('message') as string;
      const urlTags = formData.get('url_tags') as string;
      const headline = formData.get('headline') as string;
      const description = formData.get('description') as string;
      const callToAction = formData.get('call_to_action') as string;
      const imageHash = formData.get('image_hash') as string;
      const videoId = formData.get('video_id') as string;
      const status = (formData.get('status') as string) || 'PAUSED';

      const objectStorySpec: Record<string, unknown> = { page_id: pageId };

      if (instagramActorId) {
        objectStorySpec.instagram_actor_id = instagramActorId;
      }

      if (videoId) {
        const videoData: Record<string, unknown> = {
          video_id: videoId,
          call_to_action: { type: callToAction || 'LEARN_MORE', value: { link } },
        };

        if (message) videoData.message = message;
        if (headline) videoData.title = headline;
        if (description) videoData.link_description = description;
        objectStorySpec.video_data = videoData;
      } else {
        const linkData: Record<string, unknown> = {
          link,
          call_to_action: { type: callToAction || 'LEARN_MORE' },
        };

        if (message) linkData.message = message;
        if (headline) linkData.name = headline;
        if (description) linkData.description = description;
        if (imageHash) linkData.image_hash = imageHash;
        objectStorySpec.link_data = linkData;
      }

      const creativeBody: Record<string, unknown> = {
        name: `${name} Creative`,
        object_story_spec: objectStorySpec,
      };

      if (urlTags) creativeBody.url_tags = urlTags;

      logger.info('Creative body', JSON.stringify(creativeBody, null, 2));

      const creative = await meta.request(`/act_${session.ad_account_id}/adcreatives`, {
        method: 'POST',
        body: creativeBody,
      });

      const ad = await meta.request(`/act_${session.ad_account_id}/ads`, {
        method: 'POST',
        body: {
          name,
          adset_id: adsetId,
          creative: { creative_id: (creative as { id: string }).id },
          status,
        },
      });

      return NextResponse.json(ad);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: unknown) {
    logger.error('Upload error', error);
    const metaError = (
      error as {
        metaError?: {
          message?: string;
          error_user_msg?: string;
          error_user_title?: string;
          code?: number;
          error_subcode?: number;
          fbtrace_id?: string;
        };
      }
    )?.metaError;
    const message =
      metaError?.message || (error instanceof Error ? error.message : 'Upload failed');
    const errorDetail = metaError?.error_user_msg || metaError?.error_user_title || '';

    return NextResponse.json(
      {
        error: {
          message,
          detail: errorDetail,
          meta_error_code: metaError?.code,
          meta_error_subcode: metaError?.error_subcode,
          fbtrace_id: metaError?.fbtrace_id,
        },
      },
      { status: 500 }
    );
  }
}
