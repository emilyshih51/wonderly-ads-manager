import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { metaApi } from '@/lib/meta-api';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await request.formData();
    const action = formData.get('action') as string;

    if (action === 'upload_image') {
      // Upload image to Meta
      const imageFormData = new FormData();
      const file = formData.get('file') as File;
      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

      const bytes = await file.arrayBuffer();
      const blob = new Blob([bytes], { type: file.type });
      imageFormData.append('filename', blob, file.name);
      imageFormData.append('access_token', session.meta_access_token);

      const response = await fetch(
        `https://graph.facebook.com/v21.0/act_${session.ad_account_id}/adimages`,
        { method: 'POST', body: imageFormData }
      );
      const data = await response.json();
      return NextResponse.json(data);
    }

    if (action === 'create_ad') {
      const adsetId = formData.get('adset_id') as string;
      const name = formData.get('name') as string;
      const pageId = formData.get('page_id') as string;
      const message = formData.get('message') as string;
      const link = formData.get('link') as string;
      const urlTags = formData.get('url_tags') as string;
      const headline = formData.get('headline') as string;
      const description = formData.get('description') as string;
      const callToAction = formData.get('call_to_action') as string;
      const imageHash = formData.get('image_hash') as string;
      const status = formData.get('status') as string || 'PAUSED';

      // Build link_data — only include fields that have actual values
      // NOTE: `caption` (display link) was deprecated in Meta API v21.0 — removed
      const linkData: any = {
        link,
        call_to_action: { type: callToAction || 'LEARN_MORE' },
      };
      if (message) linkData.message = message;
      if (headline) linkData.name = headline;
      if (description) linkData.description = description;
      if (imageHash) linkData.image_hash = imageHash;

      // Create creative
      const creativeBody: any = {
        name: `${name} Creative`,
        object_story_spec: {
          page_id: pageId,
          link_data: linkData,
        },
      };

      // url_tags is the Meta-supported way to add dynamic tracking params
      // Must be on the creative body, not inside link_data
      if (urlTags) {
        creativeBody.url_tags = urlTags;
      }

      console.log('[create_ad] Creative body:', JSON.stringify(creativeBody, null, 2));

      const creative = await metaApi(`/act_${session.ad_account_id}/adcreatives`, session.meta_access_token, {
        method: 'POST',
        body: creativeBody,
      });

      // Create ad
      const ad = await metaApi(`/act_${session.ad_account_id}/ads`, session.meta_access_token, {
        method: 'POST',
        body: {
          name,
          adset_id: adsetId,
          creative: { creative_id: creative.id },
          status,
        },
      });

      return NextResponse.json(ad);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Upload error:', error);
    // Return the full Meta error details so the UI can show a useful message
    const metaError = error?.metaError;
    const message = metaError?.message || error?.message || 'Upload failed';
    const errorDetail = metaError?.error_user_msg || metaError?.error_user_title || '';
    return NextResponse.json({
      error: {
        message,
        detail: errorDetail,
        meta_error_code: metaError?.code,
        meta_error_subcode: metaError?.error_subcode,
        fbtrace_id: metaError?.fbtrace_id,
      }
    }, { status: 500 });
  }
}
