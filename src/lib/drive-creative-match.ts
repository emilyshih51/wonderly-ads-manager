/**
 * Matches a Meta ad's creative back to its original source file in the "Wonderly ads"
 * Google Drive folder, by name.
 *
 * When creative media is uploaded to Meta from a Drive file, Meta's creative object's
 * `name` field becomes that original filename (sanitized, extension stripped) with a
 * trailing " YYYY-MM-DD-<32-hex-hash>" upload-time suffix appended — e.g. a Drive file
 * named `Brad - VID - 9.4 - Growth backing v1 - Home Addition - 3.2.mov` becomes the Meta
 * creative name `Brad - VID - 09_04 _ Growth backing v1 _ Home Additions - 3.2
 * 2026-09-04-17e6d43d9c71fa1136ea07a9687f5bb8`. Confirmed to hold for both video and
 * static-image creatives.
 *
 * The two names are close but not byte-identical (Meta's own sanitization drifts on
 * punctuation-vs-underscore, zero-padding, and pluralization), so this matches on a
 * normalized token form rather than a raw string comparison. When no confident match is
 * found, the caller leaves the sheet cell blank rather than guess — see
 * `computeAdWinnerRows` in `./ad-winners.ts`.
 */

import type { DriveFile } from '@/services/google-drive';

/** Meta's trailing " YYYY-MM-DD-<32-hex-hash>" upload-time suffix. */
const META_UPLOAD_SUFFIX = / \d{4}-\d{2}-\d{2}-[0-9a-f]{32}$/i;

/** Strip a file extension, e.g. `"clip.mov"` -> `"clip"`. */
function stripExtension(filename: string): string {
  return filename.replace(/\.[^./]+$/, '');
}

/** Strip Meta's trailing upload-time suffix, e.g. `"clip 2026-09-04-<hash>"` -> `"clip"`. */
function stripMetaUploadSuffix(creativeName: string): string {
  return creativeName.replace(META_UPLOAD_SUFFIX, '');
}

/**
 * Normalize one token so the specific drift Meta's sanitizer introduces stops blocking an
 * otherwise-real match: a purely numeric token loses its leading zeros (`"04"` -> `"4"`,
 * matching `"4"`), and a token of more than 3 letters ending in "s" loses the trailing "s"
 * (a crude singular/plural fold — `"additions"` -> `"addition"`).
 */
function normalizeToken(token: string): string {
  if (/^\d+$/.test(token)) return String(parseInt(token, 10));
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);

  return token;
}

/**
 * Collapse a name into a normalized, order-preserving, space-joined token string: lowercase,
 * split on any run of non-alphanumeric characters (so `.`, `_`, `-`, spaces, parens all
 * become the same separator), then normalize each token.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map(normalizeToken)
    .join(' ');
}

/**
 * Build a lookup from normalized filename -> Drive file, from every file found under the
 * "Wonderly ads" Drive root (via `GoogleDriveService.listAllFilesRecursive`).
 *
 * Build once per cron run and reuse across every ad — rebuilding per ad would mean one
 * Drive tree walk per ad instead of one for the whole run.
 *
 * @param files - Every file under the Drive root
 */
export function buildDriveCreativeIndex(files: DriveFile[]): Map<string, DriveFile> {
  const index = new Map<string, DriveFile>();

  for (const file of files) {
    const key = normalize(stripExtension(file.name));

    // First match wins on a name collision across dated batch folders (rare) — either
    // file is a reasonable link to surface, and picking one deterministically beats
    // dropping the match entirely.
    if (!index.has(key)) index.set(key, file);
  }

  return index;
}

/**
 * Look up the Drive file a Meta creative was originally uploaded from, by name.
 *
 * @param creativeName - The ad's creative `name` field, from `MetaService.getAdCreativeNameMap`
 * @param index - Built once per run via {@link buildDriveCreativeIndex}
 * @returns The matching Drive file, or `undefined` when no confident match is found — the
 *   caller should leave the sheet cell blank rather than guess
 */
export function matchDriveCreative(
  creativeName: string,
  index: Map<string, DriveFile>
): DriveFile | undefined {
  return index.get(normalize(stripMetaUploadSuffix(creativeName)));
}
