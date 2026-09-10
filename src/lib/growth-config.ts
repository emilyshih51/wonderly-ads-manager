/**
 * Shared Growth Sheet configuration — the fixed constants and date helpers used by both
 * the cron (`/api/cron/marketing-daily`) and the read-only MCP server (`/api/mcp`). Keeping
 * them here means the two always agree on the backfill anchor and ad account.
 */

/** Wonderly's own ad account (the contractor-acquisition spend, not client accounts). */
export const WONDERLY_AD_ACCOUNT_ID = '1403742814420018';

/**
 * The Meta Business Manager ID that owns `WONDERLY_AD_ACCOUNT_ID` ("Wonderly Marketing").
 * Ads Manager's per-ad deep link (`buildAdsManagerAdLink`) requires this alongside the
 * account ID and ad ID — omitting it still resolves, but not to the same standalone edit
 * view a `business_id`-qualified link opens.
 */
export const WONDERLY_BUSINESS_ID = '1630682394838664';

/**
 * Root Google Drive folder ("Wonderly ads") holding every ad creative's original source
 * file, organized into dated batch folders → "Campaign N" → "Ad set N" subfolders. Used by
 * the Ad Winners sheet to link each ad back to its source file (see
 * `src/services/google-drive/index.ts` and `src/lib/drive-creative-match.ts`).
 */
export const WONDERLY_ADS_DRIVE_ROOT_FOLDER_ID = '1DHr3f6PWf_knLFjyOwccjQAxu6gUy0cI';

/**
 * Fixed backfill anchor: all Growth data is sourced and shown from this date forward
 * (first week the sales pipeline data exists). The fetch window is derived from it.
 */
export const BACKFILL_START = '2026-05-01';

/** A date as `YYYY-MM-DD` (UTC). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Whole days from an anchor date up to `today` (both `YYYY-MM-DD`, UTC).
 *
 * @param startIso - The anchor date
 * @param today - Today's date
 */
export function daysSince(startIso: string, today: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);

  return Math.round((end - start) / 86_400_000);
}
