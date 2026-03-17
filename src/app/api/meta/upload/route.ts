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
      const displayLink = formData.get('display_link') as string;
      const callToAction = formData.get('call_to_action') as string;
      const imageHash = formData.get('image_hash') as string;
      const status = formData.get('status') as string || 'PAUSED';

      // Create creative
      // Meta requires `link` to be a clean URL — tracking params go in `url_tags`
      const creativeBody: any = {
        name: `${name} Creative`,
        object_story_spec: {
          page_id: pageId,
          link_data: {
            message,
            link,
            name: headline,
            ...(description && { description }),
            ...(displayLink && { caption: displayLink }),
            ...(imageHash && { image_hash: imageHash }),
            call_to_action: { type: callToAction || 'LEARN_MORE' },
          },
        },
      };
      // url_tags is the Meta-supported way to add dynamic tracking params
      if (urlTags) {
        creativeBody.url_tags = urlTags;
      }

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
    const message = error?.response?.data?.error?.message || error?.message || 'Upload failed';
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
