import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { META_BASE_URL } from '@/services/meta/constants';

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
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await request.formData();
    const action = formData.get('action') as string;

    const meta = new MetaService(session.meta_access_token, session.ad_account_id);

    if (action === 'upload_image') {
      const file = formData.get('file') as File;

      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

      const bytes = await file.arrayBuffer();
      const blob = new Blob([bytes], { type: file.type });
      const imageFormData = new FormData();

      imageFormData.append('filename', blob, file.name);
      imageFormData.append('access_token', session.meta_access_token);

      const response = await fetch(`${META_BASE_URL}/act_${session.ad_account_id}/adimages`, {
        method: 'POST',
        body: imageFormData,
      });
      const data = await response.json();

      return NextResponse.json(data);
    }

    if (action === 'upload_video') {
      const file = formData.get('file') as File;

      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

      const bytes = await file.arrayBuffer();
      const blob = new Blob([bytes], { type: file.type });
      const videoFormData = new FormData();

      videoFormData.append('source', blob, file.name);
      videoFormData.append('title', file.name.replace(/\.[^.]+$/, ''));
      videoFormData.append('access_token', session.meta_access_token);

      const response = await fetch(`${META_BASE_URL}/act_${session.ad_account_id}/advideos`, {
        method: 'POST',
        body: videoFormData,
      });

      const responseText = await response.text();
      let data;

      try {
        data = JSON.parse(responseText);
      } catch {
        console.error('[upload_video] Non-JSON response:', responseText.substring(0, 500));

        return NextResponse.json(
          { error: { message: `Video upload failed: ${response.status} ${response.statusText}` } },
          { status: 500 }
        );
      }

      if (data.error) {
        return NextResponse.json({ error: data.error }, { status: 400 });
      }

      return NextResponse.json(data);
    }

    if (action === 'create_ad') {
      const adsetId = formData.get('adset_id') as string;
      const name = formData.get('name') as string;
      const pageId = formData.get('page_id') as string;
      const instagramActorId = formData.get('instagram_actor_id') as string;
      const message = formData.get('message') as string;
      const link = formData.get('link') as string;
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

      console.log('[create_ad] Creative body:', JSON.stringify(creativeBody, null, 2));

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
    console.error('Upload error:', error);
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
