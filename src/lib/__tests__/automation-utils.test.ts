import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
  getResultCount,
  getCostPerResult,
  calculateNewBudget,
  MIN_DAILY_BUDGET_DOLLARS,
  MAX_BUDGET_STEP_MULTIPLIER,
} from '@/lib/automation-utils';

describe('calculateNewBudget()', () => {
  it('increases by percent', () => {
    // $100 + 10% = $110 = 11000 cents
    expect(calculateNewBudget(10000, 'increase', 'percent', 10)).toBe(11000);
  });

  it('decreases by percent', () => {
    // $100 - 20% = $80 = 8000 cents
    expect(calculateNewBudget(10000, 'decrease', 'percent', 20)).toBe(8000);
  });

  it('increases by fixed amount', () => {
    // $100 + $50 = $150 = 15000 cents
    expect(calculateNewBudget(10000, 'increase', 'fixed', 50)).toBe(15000);
  });

  it('decreases by fixed amount', () => {
    // $100 - $30 = $70 = 7000 cents
    expect(calculateNewBudget(10000, 'decrease', 'fixed', 30)).toBe(7000);
  });

  it(`clamps to minimum $${MIN_DAILY_BUDGET_DOLLARS}/day`, () => {
    // $10 - 99% would be $0.10 — should clamp to $1 = 100 cents
    expect(calculateNewBudget(1000, 'decrease', 'percent', 99)).toBe(100);
  });

  it(`clamps to ${MAX_BUDGET_STEP_MULTIPLIER}x maximum per step`, () => {
    // $100 + 2000% would be $2100 — capped at 10x = $1000 = 100000 cents
    expect(calculateNewBudget(10000, 'increase', 'percent', 2000)).toBe(100000);
  });

  it('rounds to nearest cent', () => {
    // $100 + 1% = $101.00 = 10100 cents (exact)
    expect(calculateNewBudget(10000, 'increase', 'percent', 1)).toBe(10100);
    // $100 + 33.33% ≈ $133.33 = 13333 cents
    expect(calculateNewBudget(10000, 'increase', 'percent', 33.33)).toBe(13333);
  });
});

describe('evaluateCondition()', () => {
  it('evaluates > correctly', () => {
    expect(evaluateCondition(10, '>', 5)).toBe(true);
    expect(evaluateCondition(5, '>', 10)).toBe(false);
    expect(evaluateCondition(5, '>', 5)).toBe(false);
  });

  it('evaluates < correctly', () => {
    expect(evaluateCondition(3, '<', 10)).toBe(true);
    expect(evaluateCondition(10, '<', 3)).toBe(false);
    expect(evaluateCondition(5, '<', 5)).toBe(false);
  });

  it('evaluates >= correctly', () => {
    expect(evaluateCondition(5, '>=', 5)).toBe(true);
    expect(evaluateCondition(6, '>=', 5)).toBe(true);
    expect(evaluateCondition(4, '>=', 5)).toBe(false);
  });

  it('evaluates <= correctly', () => {
    expect(evaluateCondition(5, '<=', 5)).toBe(true);
    expect(evaluateCondition(4, '<=', 5)).toBe(true);
    expect(evaluateCondition(6, '<=', 5)).toBe(false);
  });

  it('evaluates == correctly', () => {
    expect(evaluateCondition(5, '==', 5)).toBe(true);
    expect(evaluateCondition(5, '==', 6)).toBe(false);
  });

  it('returns false for unknown operators', () => {
    expect(evaluateCondition(5, '!=', 5)).toBe(false);
    expect(evaluateCondition(5, 'gt', 5)).toBe(false);
  });
});

describe('getResultCount()', () => {
  const optMap: Record<string, string> = {
    c1: 'offsite_conversion.fb_pixel_lead',
  };

  it('returns 0 when actions array is missing', () => {
    expect(getResultCount({ actions: undefined, campaign_id: 'c1' }, 'c1', optMap)).toBe(0);
    expect(getResultCount({ actions: [], campaign_id: 'c1' }, 'c1', optMap)).toBe(0);
  });

  it('returns count for the exact optimization action type', () => {
    const row = {
      campaign_id: 'c1',
      actions: [
        { action_type: 'offsite_conversion.fb_pixel_lead', value: '7' },
        { action_type: 'link_click', value: '100' },
      ],
    };

    expect(getResultCount(row, 'c1', optMap)).toBe(7);
  });

  it('returns 0 when optimization action is not found in row', () => {
    const row = {
      campaign_id: 'c1',
      actions: [{ action_type: 'link_click', value: '50' }],
    };

    expect(getResultCount(row, 'c1', optMap)).toBe(0);
  });

  it('returns 0 when optimization map exists but actions contain a different conversion type', () => {
    // Campaign c1 is optimized for fb_pixel_lead, but actions only contain start_trial.
    // Should NOT fall through to the generic fallback and pick up start_trial.
    const row = {
      campaign_id: 'c1',
      actions: [
        { action_type: 'offsite_conversion.fb_pixel_start_trial', value: '5' },
        { action_type: 'link_click', value: '50' },
      ],
    };

    expect(getResultCount(row, 'c1', optMap)).toBe(0);
  });

  it('uses generic fallback for campaigns not in the optimization map', () => {
    const row = {
      campaign_id: 'c_unknown',
      actions: [
        { action_type: 'link_click', value: '100' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' },
      ],
    };

    expect(getResultCount(row, 'c_unknown', optMap)).toBe(3);
  });

  it('counts standalone lead action type in fallback', () => {
    const row = {
      campaign_id: 'c_unknown',
      actions: [{ action_type: 'lead', value: '4' }],
    };

    expect(getResultCount(row, 'c_unknown', optMap)).toBe(4);
  });

  it('counts standalone complete_registration action type in fallback', () => {
    const row = {
      campaign_id: 'c_unknown',
      actions: [{ action_type: 'complete_registration', value: '2' }],
    };

    expect(getResultCount(row, 'c_unknown', optMap)).toBe(2);
  });

  it('excludes post_engagement actions in fallback', () => {
    const row = {
      campaign_id: 'c_unknown',
      actions: [
        { action_type: 'post_engagement', value: '999' },
        { action_type: 'onsite_conversion.lead_grouped', value: '6' },
      ],
    };

    expect(getResultCount(row, 'c_unknown', optMap)).toBe(6);
  });

  it('fuzzy-matches omni_ prefixed action when optimization map expects offsite_conversion', () => {
    const row = {
      campaign_id: 'c1',
      actions: [
        { action_type: 'omni_lead', value: '5' },
        { action_type: 'link_click', value: '100' },
      ],
    };

    // optMap maps c1 → 'offsite_conversion.fb_pixel_lead'
    // No exact match, but 'omni_lead' fuzzy-matches via extractEventName('lead')
    expect(getResultCount(row, 'c1', optMap)).toBe(5);
  });

  it('fuzzy-matches omni_complete_registration for complete_registration campaigns', () => {
    const map = { c2: 'offsite_conversion.fb_pixel_complete_registration' };
    const row = {
      campaign_id: 'c2',
      actions: [
        { action_type: 'omni_complete_registration', value: '3' },
        { action_type: 'link_click', value: '50' },
      ],
    };

    expect(getResultCount(row, 'c2', map)).toBe(3);
  });

  it('counts omni_ prefixed actions in generic fallback', () => {
    const row = {
      campaign_id: 'c_unknown',
      actions: [
        { action_type: 'omni_purchase', value: '8' },
        { action_type: 'link_click', value: '200' },
      ],
    };

    expect(getResultCount(row, 'c_unknown', optMap)).toBe(8);
  });

  it('prefers exact match over fuzzy match', () => {
    const row = {
      campaign_id: 'c1',
      actions: [
        { action_type: 'offsite_conversion.fb_pixel_lead', value: '10' },
        { action_type: 'omni_lead', value: '12' },
      ],
    };

    // Exact match should win
    expect(getResultCount(row, 'c1', optMap)).toBe(10);
  });
});

describe('getCostPerResult()', () => {
  const optMap = { c1: 'offsite_conversion.fb_pixel_lead' };

  it('returns null when results is 0', () => {
    const row = { spend: '50', campaign_id: 'c1', actions: [] };

    expect(getCostPerResult(row, 'c1', optMap)).toBeNull();
  });

  it('returns spend divided by results', () => {
    const row = {
      spend: '100',
      campaign_id: 'c1',
      actions: [{ action_type: 'offsite_conversion.fb_pixel_lead', value: '5' }],
    };

    expect(getCostPerResult(row, 'c1', optMap)).toBe(20);
  });
});
