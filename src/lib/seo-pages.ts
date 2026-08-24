/**
 * SEO Pages — which organic-search landing pages actually produce customers.
 *
 * SEO's unit of investment is the page, not the day or the dollar, so this tab answers the
 * question Daily Funnel can't: of the pages Google sends people to, which ones carry them
 * all the way to an accepted contractor, and which ones only bring traffic.
 *
 * A person is credited to the FIRST page they landed on in the window, for their whole
 * funnel — so a visitor who lands on `/pricing`, reads three more pages and books is a
 * `/pricing` conversion. Attribution is first-touch on purpose: it measures what the page
 * won from the search result, not where the person happened to be when they converted.
 *
 * Rows are ordered by accepted, then booked, then sessions, so the pages that earn revenue
 * sit at the top regardless of traffic. Low-traffic pages are folded into a single
 * `(other pages)` row so the tab stays readable — the fold-in threshold is
 * {@link MIN_SESSIONS_TO_LIST}, and the folded row still carries its real totals.
 *
 * Same maturation caveat as the rest of the sheet: HELD / ACCEPTED lag the traffic that
 * produced them, so a page that started ranking recently reads worse than it is.
 */

import type { SheetsRequest } from '@/lib/daily-metrics-format';

/** One organic landing page's funnel, as returned by `SnowflakeService.getSeoLandingPages`. */
export interface SeoPageRow {
  /** Site-relative path of the landing page, e.g. `/pricing`. */
  path: string;
  /** Unique organic-search people whose first page view in the window was this path. */
  sessions: number;
  cta: number;
  submitPartial: number;
  submitQualified: number;
  booked: number;
  held: number;
  accepted: number;
}

/**
 * Pages with fewer sessions than this are folded into a single `(other pages)` row. Set low
 * enough that a genuinely converting long-tail page still shows up on its own — a page that
 * booked a call is never folded in, regardless of traffic (see {@link foldSmallPages}).
 */
export const MIN_SESSIONS_TO_LIST = 10;

/** Label for the folded-in long tail. */
const OTHER_LABEL = '(other pages)';

/** Column order for the SEO Pages tab. */
export const SEO_PAGES_HEADERS = [
  'PATH',
  'SESSIONS',
  'CTA',
  'PARTIAL',
  'QUALIFIED',
  'QUAL_RATE',
  'CALL1_BOOKED',
  'HELD',
  'ACCEPTED',
  'SESSION_TO_QUALIFIED',
  'SESSION_TO_ACCEPTED',
] as const;

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : 0;
}

const ZERO: Omit<SeoPageRow, 'path'> = {
  sessions: 0,
  cta: 0,
  submitPartial: 0,
  submitQualified: 0,
  booked: 0,
  held: 0,
  accepted: 0,
};

/**
 * Fold pages below the traffic threshold into one `(other pages)` row.
 *
 * A page that produced a booking is always kept, however little traffic it had — those are
 * exactly the long-tail wins the tab exists to surface.
 *
 * @param rows - Per-page rows from `getSeoLandingPages`
 * @param minSessions - Traffic floor for keeping a page on its own row
 * @returns Kept rows (input order preserved) with at most one appended `(other pages)` row
 */
export function foldSmallPages(
  rows: SeoPageRow[],
  minSessions: number = MIN_SESSIONS_TO_LIST
): SeoPageRow[] {
  const kept: SeoPageRow[] = [];
  const folded = { ...ZERO };
  let foldedAny = false;

  for (const r of rows) {
    if (r.sessions >= minSessions || r.booked > 0) {
      kept.push(r);
      continue;
    }

    foldedAny = true;
    folded.sessions += r.sessions;
    folded.cta += r.cta;
    folded.submitPartial += r.submitPartial;
    folded.submitQualified += r.submitQualified;
    folded.booked += r.booked;
    folded.held += r.held;
    folded.accepted += r.accepted;
  }

  return foldedAny ? [...kept, { path: OTHER_LABEL, ...folded }] : kept;
}

/**
 * Build the SEO Pages cell matrix in {@link SEO_PAGES_HEADERS} order, with a leading
 * `Total` row (rates as ratio-of-totals).
 *
 * @param rows - Per-page rows from `getSeoLandingPages`
 */
export function toSeoPagesValues(rows: SeoPageRow[]): (string | number)[][] {
  const folded = foldSmallPages(rows);

  const line = (r: SeoPageRow): (string | number)[] => [
    r.path,
    r.sessions,
    r.cta,
    r.submitPartial,
    r.submitQualified,
    rate(r.submitQualified, r.submitPartial),
    r.booked,
    r.held,
    r.accepted,
    rate(r.submitQualified, r.sessions),
    rate(r.accepted, r.sessions),
  ];

  const totals = folded.reduce(
    (t, r) => ({
      sessions: t.sessions + r.sessions,
      cta: t.cta + r.cta,
      submitPartial: t.submitPartial + r.submitPartial,
      submitQualified: t.submitQualified + r.submitQualified,
      booked: t.booked + r.booked,
      held: t.held + r.held,
      accepted: t.accepted + r.accepted,
    }),
    { ...ZERO }
  );

  return [line({ path: 'Total', ...totals }), ...folded.map(line)];
}

/**
 * Formatting for the SEO Pages tab: frozen bold header, bold Total row, percent formats on
 * the three rate columns, and a green-scale heat map on SESSION_TO_ACCEPTED so the pages
 * that convert stand out from the pages that merely get traffic.
 *
 * @param sheetId - The tab's numeric gid
 * @param rowCount - Number of value rows written below the header (incl. the Total row)
 */
export function buildSeoPagesFormatRequests(sheetId: number, rowCount: number): SheetsRequest[] {
  const PERCENT = { type: 'PERCENT', pattern: '0.00%' };
  const HEADER_BG = { red: 0.92, green: 0.92, blue: 0.94 };
  const dataEnd = rowCount + 1;
  // Skip the Total row in the heat map — it would always be the midpoint and flatten the scale.
  const bodyStart = 2;

  const pct = (index: number): SheetsRequest => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: dataEnd,
        startColumnIndex: index,
        endColumnIndex: index + 1,
      },
      cell: { userEnteredFormat: { numberFormat: PERCENT } },
      fields: 'userEnteredFormat.numberFormat',
    },
  });

  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: HEADER_BG } },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 } },
        fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
      },
    },
    pct(5),
    pct(9),
    pct(10),
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    ...(rowCount > bodyStart
      ? [
          {
            addConditionalFormatRule: {
              index: 0,
              rule: {
                ranges: [
                  {
                    sheetId,
                    startRowIndex: bodyStart,
                    endRowIndex: dataEnd,
                    startColumnIndex: 10,
                    endColumnIndex: 11,
                  },
                ],
                gradientRule: {
                  minpoint: { color: { red: 1, green: 1, blue: 1 }, type: 'MIN' },
                  maxpoint: {
                    color: { red: 0.72, green: 0.88, blue: 0.75 },
                    type: 'MAX',
                  },
                },
              },
            },
          },
        ]
      : []),
  ];
}
