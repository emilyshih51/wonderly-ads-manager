import { describe, expect, it } from 'vitest';

import { DEFINITIONS_HEADERS, toDefinitionsValues } from '@/lib/definitions';

describe('toDefinitionsValues', () => {
  it('emits every row in header width', () => {
    const rows = toDefinitionsValues();

    expect(rows.length).toBeGreaterThan(30);
    expect(rows.every((r) => r.length === DEFINITIONS_HEADERS.length)).toBe(true);
  });

  it('documents the fields users ask about', () => {
    const fields = toDefinitionsValues().map((r) => String(r[0]));

    expect(fields).toContain('CALL1_RATE');
    expect(fields).toContain('COST_PCT_CHANGE');
    expect(fields.some((f) => f.includes('BOOKED_ALL'))).toBe(true);
  });
});
