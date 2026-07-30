import { describe, expect, it } from 'vitest';

import { toCall1DealsValues, CALL1_DEALS_HEADERS, type Call1DealRow } from '@/lib/call1-deals';

function deal(o: Partial<Call1DealRow> = {}): Call1DealRow {
  return {
    dealId: 'd1',
    dealName: 'Test Deal',
    bookedDay: '2026-07-20',
    currentStage: 'Call 1 Scheduled',
    held: 0,
    accepted: 0,
    noShow: 0,
    disqualified: 0,
    estAmount: 0,
    contactName: 'Jane Doe',
    phone: '+15551234567',
    email: 'jane@example.com',
    source: 'facebook',
    campaignId: '',
    adId: '',
    heldDate: '',
    acceptedDate: '',
    ...o,
  };
}

describe('toCall1DealsValues', () => {
  it('emits columns in header order', () => {
    const values = toCall1DealsValues([
      deal({
        dealId: 'abc',
        dealName: 'Harrison Wermuth (Dewittbuilding)',
        bookedDay: '2026-07-22',
        currentStage: 'Accepted',
        held: 1,
        accepted: 1,
        noShow: 0,
        estAmount: 12000,
        contactName: 'Harrison Wermuth',
        phone: '+15550001111',
        email: 'harrison@dewittbuilding.com',
        source: 'facebook',
        campaignId: '120242022304100408',
        adId: '120246607811180408',
        acceptedDate: '2026-07-24',
      }),
    ]);

    expect(values[0]).toEqual([
      'abc',
      'Harrison Wermuth (Dewittbuilding)',
      '2026-07-22',
      'Accepted',
      1, // HELD
      1, // ACCEPTED
      0, // NO_SHOW
      0, // DISQUALIFIED
      12000,
      'Harrison Wermuth',
      '+15550001111',
      'harrison@dewittbuilding.com',
      'facebook',
      '120242022304100408', // CAMPAIGN_ID
      '120246607811180408', // AD_ID
      '', // HELD_DATE
      '2026-07-24', // ACCEPTED_DATE
    ]);
    expect(values[0]).toHaveLength(CALL1_DEALS_HEADERS.length);
  });

  it('emits a row for a non-booked accepted deal (blank BOOKED_DAY)', () => {
    const values = toCall1DealsValues([
      deal({
        dealId: 'noBooking',
        bookedDay: '',
        accepted: 1,
        held: 1,
        acceptedDate: '2026-05-20',
      }),
    ]);

    expect(values[0][2]).toBe(''); // BOOKED_DAY blank
    expect(values[0][5]).toBe(1); // ACCEPTED still counted
  });
});
