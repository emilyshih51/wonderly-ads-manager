/**
 * GoogleSheetsService — writes rows to a Google Sheet via the Sheets v4 REST API.
 *
 * Authenticates as a service account (a robot user with its own email address).
 * The target sheet must be shared with that email as an Editor — without it every
 * call returns 403 regardless of whether the credentials are valid.
 *
 * @example
 * ```ts
 * const sheets = GoogleSheetsService.fromEnv();
 * await sheets.replaceRows(sheetId, 'wonderly_daily', headers, rows);
 * ```
 */

import { JWT } from 'google-auth-library';

const SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export class GoogleSheetsApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'GoogleSheetsApiError';
  }
}

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

export class GoogleSheetsService {
  private client: JWT;

  constructor(credentials: ServiceAccountCredentials) {
    this.client = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [SHEETS_SCOPE],
    });
  }

  /**
   * Build a service from `GOOGLE_SERVICE_ACCOUNT_JSON`.
   *
   * The env var holds the base64-encoded service account key file. Base64 rather
   * than raw JSON because `private_key` contains literal newlines, which env vars
   * mangle — producing a `PEM routines:get_name:no start line` error that gives
   * no hint about the real cause.
   *
   * @throws When the env var is missing or does not decode to valid credentials
   */
  static fromEnv(): GoogleSheetsService {
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

    return new GoogleSheetsService(parsed);
  }

  /**
   * Authorised request against the Sheets v4 API.
   *
   * @param path - Path below the spreadsheets base, e.g. `/{id}/values/Tab!A1`
   * @param init - Standard fetch init; `Authorization` is added automatically
   * @throws {GoogleSheetsApiError} On any non-2xx response
   */
  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.client.getAccessToken();
    const response = await fetch(`${SHEETS_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const body = await response.text();
      const hint =
        response.status === 403
          ? ' — is the sheet shared with the service account email as an Editor?'
          : '';

      throw new GoogleSheetsApiError(
        `Sheets API ${response.status} on ${path}${hint}: ${body.slice(0, 300)}`,
        response.status
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Overwrite a tab entirely with a header row plus data rows.
   *
   * Clears first so a shorter dataset cannot leave orphaned rows below the new
   * data — which would otherwise be read by the sheet's formulas as real days.
   *
   * @param spreadsheetId - Sheet ID from its URL
   * @param tabName - Exact tab name, e.g. `wonderly_daily`
   * @param headers - Header row; the sheet's INDIRECT/MATCH formulas look these up by name
   * @param rows - Data rows, ordered newest first to match the sheet's convention
   */
  async replaceRows(
    spreadsheetId: string,
    tabName: string,
    headers: string[],
    rows: (string | number)[][]
  ): Promise<void> {
    await this.request(`/${spreadsheetId}/values/${encodeURIComponent(tabName)}:clear`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    await this.request(
      `/${spreadsheetId}/values/${encodeURIComponent(`${tabName}!A1`)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        body: JSON.stringify({ values: [headers, ...rows] }),
      }
    );
  }

  /**
   * Read the values of a tab, including the header row.
   *
   * @param spreadsheetId - Sheet ID from its URL
   * @param tabName - Exact tab name
   * @returns Raw cell values, or an empty array if the tab is empty
   */
  async readRows(spreadsheetId: string, tabName: string): Promise<string[][]> {
    const data = await this.request<{ values?: string[][] }>(
      `/${spreadsheetId}/values/${encodeURIComponent(tabName)}`
    );

    return data.values ?? [];
  }
}
