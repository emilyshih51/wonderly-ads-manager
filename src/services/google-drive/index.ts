/**
 * GoogleDriveService — read-only Drive v3 client for indexing the "Wonderly ads" creative
 * folder tree.
 *
 * Authenticates as the same service account as `GoogleSheetsService` (same
 * `GOOGLE_SERVICE_ACCOUNT_JSON`), just with the `drive.readonly` scope instead of
 * `spreadsheets`. The target Drive folder must be shared with that service account's
 * `client_email` (Viewer is enough — this client only ever lists and reads metadata).
 *
 * @example
 * ```ts
 * const drive = GoogleDriveService.fromEnv();
 * const files = await drive.listAllFilesRecursive(WONDERLY_ADS_DRIVE_ROOT_FOLDER_ID);
 * ```
 */

import { JWT } from 'google-auth-library';

const DRIVE_BASE_URL = 'https://www.googleapis.com/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export class GoogleDriveApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'GoogleDriveApiError';
  }
}

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

/** One non-folder file found under the indexed Drive tree. */
export interface DriveFile {
  id: string;
  name: string;
}

export class GoogleDriveService {
  private client: JWT;

  constructor(credentials: ServiceAccountCredentials) {
    this.client = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [DRIVE_SCOPE],
    });
  }

  /**
   * Build a service from `GOOGLE_SERVICE_ACCOUNT_JSON` — the same base64-encoded service
   * account key file `GoogleSheetsService` uses, just authorized here for Drive instead of
   * Sheets. See `GoogleSheetsService.fromEnv` for why it's base64 rather than raw JSON.
   *
   * @throws When the env var is missing or does not decode to valid credentials
   */
  static fromEnv(): GoogleDriveService {
    const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!encoded) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');

    let parsed: ServiceAccountCredentials;

    try {
      parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    } catch {
      throw new Error(
        'GOOGLE_SERVICE_ACCOUNT_JSON is not valid base64-encoded JSON. Generate it with: base64 -i key.json'
      );
    }

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key');
    }

    return new GoogleDriveService(parsed);
  }

  /**
   * Authorised GET against the Drive v3 API.
   *
   * @param path - Path below the Drive v3 base, e.g. `/files`
   * @param params - Query params (merged with the auth token)
   * @throws {GoogleDriveApiError} On any non-2xx response
   */
  private async request<T = unknown>(
    path: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    // Same retry posture as GoogleSheetsService: one blip shouldn't fail the whole refresh.
    const RETRYABLE = new Set([429, 500, 502, 503, 504]);
    const MAX_ATTEMPTS = 4;

    for (let attempt = 1; ; attempt++) {
      const token = await this.client.getAccessToken();
      const url = new URL(`${DRIVE_BASE_URL}${path}`);

      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token.token}` },
        cache: 'no-store',
      });

      if (response.ok) return response.json() as Promise<T>;

      const body = await response.text();

      if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
        continue;
      }

      const hint =
        response.status === 403
          ? ' — is the folder shared with the service account email as at least a Viewer?'
          : '';

      throw new GoogleDriveApiError(
        `Drive API ${response.status} on ${path}${hint}: ${body.slice(0, 300)}`,
        response.status
      );
    }
  }

  /**
   * Walk every subfolder under `rootFolderId` and collect every non-folder file found,
   * anywhere in the tree (breadth-first, fully paginated at each folder level).
   *
   * Used once per Ad Winners run to build the creative-matching index — see
   * `buildDriveCreativeIndex` in `@/lib/drive-creative-match`.
   *
   * @param rootFolderId - The "Wonderly ads" root folder ID
   * @returns Every file's `id` and `name`; folders themselves are not included
   */
  async listAllFilesRecursive(rootFolderId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    const queue: string[] = [rootFolderId];

    while (queue.length > 0) {
      const folderId = queue.shift() as string;
      let pageToken: string | undefined;

      for (;;) {
        const data = await this.request<{
          files?: Array<{ id: string; name: string; mimeType: string }>;
          nextPageToken?: string;
        }>('/files', {
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id,name,mimeType)',
          pageSize: '1000',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
          ...(pageToken ? { pageToken } : {}),
        });

        for (const item of data.files ?? []) {
          if (item.mimeType === FOLDER_MIME_TYPE) {
            queue.push(item.id);
          } else {
            files.push({ id: item.id, name: item.name });
          }
        }

        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
      }
    }

    return files;
  }

  /**
   * The Drive "view in browser" link for a file, given its ID.
   *
   * @param fileId - Drive file ID (from {@link listAllFilesRecursive})
   */
  static fileLink(fileId: string): string {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }
}
