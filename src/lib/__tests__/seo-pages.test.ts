import { describe, expect, it } from 'vitest';

import {
  MIN_SESSIONS_TO_LIST,
  SEO_PAGES_HEADERS,
  buildSeoPagesFormatRequests,
  foldSmallPages,
  toSeoPagesValues,
  type SeoPageRow,
} from '@/lib/seo-pages';

function page(path: string, o: Partial<SeoPageRow> = {}): SeoPageRow {
  return {
    path,
    sessions: 0,
    cta: 0,
    submitPartial: 0,
    submitQualified: 0,
    booked: 0,
    held: 0,
    accepted: 0,
    ...o,
  };
}

const H = (name: string): number => (SEO_PAGES_HEADERS as readonly string[]).indexOf(name);

describe('foldSmallPages', () => {
  it('folds pages below the session floor into one row', () => {
    const folded = foldSmallPages([
      page('/pricing', { sessions: 50 }),
      page('/blog/a', { sessions: 3, cta: 1 }),
      page('/blog/b', { sessions: 2 }),
    ]);

    expect(folded.map((p) => p.path)).toEqual(['/pricing', '(other pages)']);
    expect(folded[1].sessions).toBe(5);
    expect(folded[1].cta).toBe(1);
  });

  it('keeps a low-traffic page that produced a booking', () => {
    const folded = foldSmallPages([page('/compare/x', { sessions: 2, booked: 1, accepted: 1 })]);

    expect(folded).toHaveLength(1);
    expect(folded[0].path).toBe('/compare/x');
  });

  it('adds no (other pages) row when nothing is folded', () => {
    const folded = foldSmallPages([page('/pricing', { sessions: MIN_SESSIONS_TO_LIST })]);

    expect(folded.map((p) => p.path)).toEqual(['/pricing']);
  });
});

describe('toSeoPagesValues', () => {
  const rows = [
    page('/', {
      sessions: 1000,
      cta: 100,
      submitPartial: 50,
      submitQualified: 20,
      booked: 10,
      held: 5,
      accepted: 3,
    }),
    page('/pricing', {
      sessions: 200,
      cta: 40,
      submitPartial: 20,
      submitQualified: 10,
      booked: 4,
      held: 2,
      accepted: 1,
    }),
  ];

  it('leads with a Total row and keeps every line header-aligned', () => {
    const values = toSeoPagesValues(rows);

    expect(values[0][0]).toBe('Total');
    expect(values[0][H('SESSIONS')]).toBe(1200);
    expect(values[0][H('ACCEPTED')]).toBe(4);
    for (const line of values) expect(line).toHaveLength(SEO_PAGES_HEADERS.length);
  });

  it('computes per-page end-to-end conversion', () => {
    const [, home, pricing] = toSeoPagesValues(rows);

    expect(home[H('SESSION_TO_ACCEPTED')]).toBe(0.003);
    expect(pricing[H('SESSION_TO_ACCEPTED')]).toBe(0.005);
    expect(pricing[H('SESSION_TO_QUALIFIED')]).toBe(0.05);
    expect(pricing[H('QUAL_RATE')]).toBe(0.5);
  });

  it('handles an empty page list without dividing by zero', () => {
    const values = toSeoPagesValues([]);

    expect(values).toHaveLength(1);
    expect(values[0].slice(1).every((c) => c === 0)).toBe(true);
  });
});

describe('buildSeoPagesFormatRequests', () => {
  it('adds a heat map only when there are body rows below the Total', () => {
    expect(JSON.stringify(buildSeoPagesFormatRequests(1, 5))).toContain('gradientRule');
    expect(JSON.stringify(buildSeoPagesFormatRequests(1, 1))).not.toContain('gradientRule');
  });
});
