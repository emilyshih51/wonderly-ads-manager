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

/**
 * Wrap a sheet/tab name for A1 notation. Names with spaces or punctuation (e.g.
 * "Daily Funnel") must be single-quoted in a range, and literal single quotes are
 * escaped by doubling. Safe to apply to simple names too.
 *
 * @param tabName - The tab title
 */
function quoteTab(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`;
}

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
    // Google's Sheets API returns transient 5xx/429 under load (503 UNAVAILABLE, rate
    // limits). One blip shouldn't fail the whole refresh, so retry those with exponential
    // backoff; everything else (4xx like 403) throws immediately.
    const RETRYABLE = new Set([429, 500, 502, 503, 504]);
    const MAX_ATTEMPTS = 4;

    for (let attempt = 1; ; attempt++) {
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

      if (response.ok) return response.json() as Promise<T>;

      const body = await response.text();

      if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS) {
        // 0.5s, 1s, 2s between the 4 attempts.
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
        continue;
      }

      const hint =
        response.status === 403
          ? ' — is the sheet shared with the service account email as an Editor?'
          : '';

      throw new GoogleSheetsApiError(
        `Sheets API ${response.status} on ${path}${hint}: ${body.slice(0, 300)}`,
        response.status
      );
    }
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
    await this.request(`/${spreadsheetId}/values/${encodeURIComponent(quoteTab(tabName))}:clear`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    // USER_ENTERED (not RAW) so "2026-07-21" is parsed into a real date value and
    // numbers into real numbers — exactly as if typed. RAW stores dates as text,
    // which silently breaks MAX() and date-range formulas in the Summary tab.
    await this.request(
      `/${spreadsheetId}/values/${encodeURIComponent(`${quoteTab(tabName)}!A1`)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        body: JSON.stringify({ values: [headers, ...rows] }),
      }
    );
  }

  /**
   * Create a tab if it does not already exist. Idempotent — safe to call every run.
   *
   * Lets the cron own its output tabs: a newly added tab (or one someone deleted)
   * is recreated automatically instead of failing the whole refresh with an
   * "Unable to parse range" error.
   *
   * @param spreadsheetId - Sheet ID from its URL
   * @param tabName - Exact tab name to ensure exists
   */
  async ensureTab(spreadsheetId: string, tabName: string): Promise<void> {
    const meta = await this.request<{ sheets?: { properties?: { title?: string } }[] }>(
      `/${spreadsheetId}?fields=sheets.properties.title`
    );

    const exists = (meta.sheets ?? []).some((s) => s.properties?.title === tabName);

    if (exists) return;

    await this.request(`/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: tabName } } }],
      }),
    });
  }

  /**
   * Delete a tab if it exists. Idempotent — a no-op when the tab is already gone, so it's
   * safe to call every run to retire a tab the cron no longer produces.
   *
   * @param spreadsheetId - Sheet ID from its URL
   * @param tabName - Exact tab name to remove
   */
  async deleteTab(spreadsheetId: string, tabName: string): Promise<void> {
    const meta = await this.request<{
      sheets?: { properties?: { sheetId?: number; title?: string } }[];
    }>(`/${spreadsheetId}?fields=sheets.properties(sheetId,title)`);

    const sheetId = (meta.sheets ?? []).find((s) => s.properties?.title === tabName)?.properties
      ?.sheetId;

    if (sheetId === undefined) return;

    await this.request(`/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ deleteSheet: { sheetId } }] }),
    });
  }

  /**
   * Apply formatting to a tab via `batchUpdate`, idempotently.
   *
   * Looks up the tab's numeric gid, deletes any conditional-format rules already on it
   * (so re-running does not stack duplicate heat-maps), then applies the caller's
   * requests. Formatting is orthogonal to values, so it persists across `replaceRows`.
   *
   * @param spreadsheetId - Sheet ID from its URL
   * @param tabName - Exact tab name to format
   * @param buildRequests - Given the tab's gid, returns the `batchUpdate` requests to apply
   * @throws When the tab does not exist
   */
  async formatTab(
    spreadsheetId: string,
    tabName: string,
    buildRequests: (sheetId: number) => Record<string, unknown>[]
  ): Promise<void> {
    const meta = await this.request<{
      sheets?: {
        properties?: { sheetId?: number; title?: string };
        conditionalFormats?: unknown[];
      }[];
    }>(`/${spreadsheetId}?fields=sheets(properties(sheetId,title),conditionalFormats)`);

    const sheet = (meta.sheets ?? []).find((s) => s.properties?.title === tabName);
    const sheetId = sheet?.properties?.sheetId;

    if (sheetId === undefined) {
      throw new GoogleSheetsApiError(`Tab "${tabName}" not found to format`, 404);
    }

    // Deleting index 0 repeatedly clears every existing rule (indices shift down).
    const clears = (sheet?.conditionalFormats ?? []).map(() => ({
      deleteConditionalFormatRule: { index: 0, sheetId },
    }));

    await this.request(`/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [...clears, ...buildRequests(sheetId)] }),
    });
  }

  /**
   * Read the values of a tab, including the header row.
   *
   * @param spreadsheetId - Sheet ID from its URL
   * @param tabName - Exact tab name
   * @returns Raw cell values, or an empty array if the tab is empty
   */
  async readRows(spreadsheetId: string, tabName: string): Promise<(string | number)[][]> {
    // UNFORMATTED_VALUE returns raw numbers, not the cell's display string — so a
    // currency-formatted spend cell reads back as 5406.88, not "$5,406.88" (which
    // Number() can't parse, silently becoming 0 and wiping preserved rows).
    // FORMATTED_STRING keeps date cells as "2026-07-20" strings for the date regex.
    const data = await this.request<{ values?: (string | number)[][] }>(
      `/${spreadsheetId}/values/${encodeURIComponent(quoteTab(tabName))}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`
    );

    return data.values ?? [];
  }
}
