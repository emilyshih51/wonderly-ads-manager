import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { createLogger } from '@/services/logger';

const logger = createLogger('GoogleDrive');

/** Supported creative MIME types. */
const CREATIVE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
]);

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  webContentLink?: string;
}

/**
 * GET /api/google-drive?folder_id=<id>
 *
 * Lists image/video files in a Google Drive folder. Requires `GOOGLE_API_KEY`
 * env var and the folder must have link sharing enabled (anyone with the link).
 */
export async function GET(request: NextRequest) {
  const sessionResult = await requireSession();

  if (sessionResult instanceof NextResponse) return sessionResult;

  const folderId = request.nextUrl.searchParams.get('folder_id');

  if (!folderId) {
    return NextResponse.json({ error: 'folder_id is required' }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Google Drive integration not configured. Set GOOGLE_API_KEY in environment.' },
      { status: 503 }
    );
  }

  logger.info('Listing Drive folder', { folderId });

  try {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    // Paginate through all files in the folder
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,size,thumbnailLink,webContentLink)',
        pageSize: '100',
        key: apiKey,
      });

      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
        cache: 'no-store',
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));

        logger.error('Drive API error', { status: res.status, error: errorData });

        return NextResponse.json(
          {
            error:
              'Failed to list Drive folder. Ensure the folder is shared (anyone with the link).',
          },
          { status: res.status === 403 || res.status === 404 ? 403 : 502 }
        );
      }

      const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };

      for (const file of data.files || []) {
        if (CREATIVE_MIME_TYPES.has(file.mimeType)) {
          files.push(file);
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return NextResponse.json({
      folder_id: folderId,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size ? parseInt(f.size) : null,
        thumbnailLink: f.thumbnailLink || null,
        isVideo: f.mimeType.startsWith('video/'),
      })),
      total: files.length,
    });
  } catch (error) {
    logger.error('Drive listing error', error);

    return NextResponse.json({ error: 'Failed to list Drive folder' }, { status: 500 });
  }
}
