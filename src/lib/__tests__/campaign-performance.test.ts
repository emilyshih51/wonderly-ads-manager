import { describe, expect, it } from 'vitest';

import type { Call1DealRow } from '@/lib/call1-deals';
import {
  CAMPAIGN_PERFORMANCE_HEADERS,
  computeCampaignPerformance,
  toCampaignPerformanceValues,
  type MetaCampaignSpend,
} from '@/lib/campaign-performance';

function deal(o: Partial<Call1DealRow> = {}): Call1DealRow {
  return {
    dealId: 'd',
    dealName: '',
    bookedDay: '2026-07-20',
    currentStage: '',
    held: 0,
    accepted: 0,
    noShow: 0,
    disqualified: 0,
    estAmount: 0,
    contactName: '',
    phone: '',
    email: '',
    source: 'facebook',
    campaignId: '',
    campaignName: '',
    adId: '',
    heldDate: '',
    acceptedDate: '',
    ...o,
  };
}

describe('computeCampaignPerformance', () => {
  it('aggregates booked/held/accepted per campaign and joins spend + CAC', () => {
    const deals = [
      deal({ campaignId: '111', campaignName: 'Roofing', held: 1, accepted: 1 }),
      deal({ campaignId: '111', campaignName: 'Roofing', held: 1, accepted: 0 }),
      deal({ campaignId: '222', campaignName: 'HVAC', held: 0, accepted: 0 }),
    ];
    const spend: MetaCampaignSpend[] = [
      { campaignId: '111', campaignName: 'Roofing', spend: 1000 },
      { campaignId: '222', campaignName: 'HVAC', spend: 500 },
    ];

    const rows = computeCampaignPerformance(deals, spend);
    const roofing = rows.find((r) => r.campaign === 'Roofing')!;

    expect(roofing.booked).toBe(2);
    expect(roofing.held).toBe(2);
    expect(roofing.accepted).toBe(1);
    expect(roofing.acceptRate).toBe(0.5);
    expect(roofing.spend).toBe(1000);
    expect(roofing.costPerAccepted).toBe(1000); // 1000 / 1 accepted
    // Sorted by accepted desc: Roofing (1) before HVAC (0).
    expect(rows[0].campaign).toBe('Roofing');
  });

  it('includes spend-only campaigns (no deals) and blanks CAC when 0 accepted', () => {
    const rows = computeCampaignPerformance(
      [deal({ campaignId: '111', campaignName: 'Roofing', accepted: 1 })],
      [
        { campaignId: '111', campaignName: 'Roofing', spend: 800 },
        { campaignId: '333', campaignName: 'Wasted', spend: 300 }, // spend, no deals
      ]
    );

    const wasted = rows.find((r) => r.campaign === 'Wasted')!;

    expect(wasted.booked).toBe(0);
    expect(wasted.accepted).toBe(0);
    expect(wasted.spend).toBe(300);
    expect(wasted.costPerAccepted).toBe(0); // no acceptances → 0 in the row model
  });

  it('buckets deals without a campaign id under an organic label', () => {
    const rows = computeCampaignPerformance([deal({ campaignId: '', accepted: 1 })], []);

    expect(rows[0].campaign).toBe('(no campaign / organic)');
    expect(rows[0].accepted).toBe(1);
  });

  it('falls back to the raw id when the name is unknown', () => {
    const rows = computeCampaignPerformance([deal({ campaignId: '444', campaignName: '' })], []);

    expect(rows[0].campaign).toBe('444');
  });
});

describe('toCampaignPerformanceValues', () => {
  it('emits header-ordered rows plus a Total, blanking rate/CAC where undefined', () => {
    const rows = computeCampaignPerformance(
      [
        deal({ campaignId: '111', campaignName: 'Roofing', held: 1, accepted: 1 }),
        deal({ campaignId: '333', campaignName: 'Wasted' }), // booked, no accept
      ],
      [
        { campaignId: '111', campaignName: 'Roofing', spend: 1000 },
        { campaignId: '333', campaignName: 'Wasted', spend: 200 },
      ]
    );
    const values = toCampaignPerformanceValues(rows);

    expect(values[0]).toHaveLength(CAMPAIGN_PERFORMANCE_HEADERS.length);

    const wasted = values.find((r) => r[0] === 'Wasted')!;

    expect(wasted[4]).toBe(0); // ACCEPT_RATE = 0 (1 booked, 0 accepted)
    expect(wasted[6]).toBe(''); // COST_PER_ACCEPTED blank (no acceptances despite $200 spend)

    const total = values[values.length - 1];

    expect(total[0]).toBe('Total');
    expect(total[1]).toBe(2); // booked
    expect(total[3]).toBe(1); // accepted
    expect(total[5]).toBe(1200); // spend
    expect(total[6]).toBe(1200); // 1200 / 1 accepted
  });
});
