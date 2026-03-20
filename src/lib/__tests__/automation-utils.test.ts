import { describe, it, expect } from 'vitest';
import { evaluateCondition, getResultCount, getCostPerResult } from '@/lib/automation-utils';

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
