import { describe, expect, it } from 'vitest';

import { MIN_SUCCEEDING, succeedingCostCell } from '@/lib/succeeding';

describe('succeedingCostCell', () => {
  it('divides cumulative spend by succeeding contractors once the cohort is large enough', () => {
    expect(succeedingCostCell(10000, MIN_SUCCEEDING, 30)).toBe(Math.round(10000 / MIN_SUCCEEDING));
    expect(succeedingCostCell(9000, 10, 40)).toBe(900);
  });

  it('shows a maturing status with counts below the minimum', () => {
    expect(succeedingCostCell(10000, 2, 8)).toBe('maturing — 2/8 cohort succeeding (ROI ≥ 2×)');
    expect(succeedingCostCell(10000, 0, 0)).toBe('maturing — 0/0 cohort succeeding (ROI ≥ 2×)');
  });
});
