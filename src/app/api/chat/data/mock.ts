/**
 * Mock data generator for AI Chat testing.
 *
 * Produces realistic Meta Ads data with intentional patterns:
 * - Campaign A: strong performer, improving daily
 * - Campaign B: high spend, declining conversions (the "problem")
 * - Campaign C: new campaign, low data, inconsistent
 *
 * This lets you test diagnostic questions like:
 * "Why are conversions low today?"
 * "Which campaigns should I pause?"
 * "Give me a health check"
 */

interface MockAction {
  action_type: string;
  value: string;
}

interface MockInsightRow {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpc: string;
  cpm: string;
  reach?: string;
  frequency?: string;
  actions?: MockAction[];
  cost_per_action_type?: MockAction[];
  cost_per_inline_link_click?: string;
  inline_link_clicks?: string;
  date_start: string;
  date_stop: string;
  age?: string;
  gender?: string;
  device_platform?: string;
  publisher_platform?: string;
  hourly_stats_aggregated_by_advertiser_time_zone?: string;
}

function makeRow(overrides: Partial<MockInsightRow> & { spend: string; clicks: string; impressions: string; leads: number; date: string }): MockInsightRow {
  const spend = parseFloat(overrides.spend);
  const clicks = parseInt(overrides.clicks);
  const impressions = parseInt(overrides.impressions);
  const leads = overrides.leads;
  const ctr = impressions > 0 ? (clicks / impressions * 100).toFixed(2) : '0';
  const cpc = clicks > 0 ? (spend / clicks).toFixed(2) : '0';
  const cpm = impressions > 0 ? (spend / impressions * 1000).toFixed(2) : '0';
  const costPerLead = leads > 0 ? (spend / leads).toFixed(2) : '0';
  const reach = Math.floor(impressions * 0.85).toString();
  // Link clicks ≈ 65% of all clicks (some clicks are post engagement, reactions, etc.)
  const linkClicks = Math.floor(clicks * 0.65);
  const costPerLinkClick = linkClicks > 0 ? (spend / linkClicks).toFixed(2) : '0';

  return {
    ...overrides,
    spend: spend.toFixed(2),
    impressions: impressions.toString(),
    clicks: clicks.toString(),
    ctr,
    cpc,
    cpm,
    reach,
    cost_per_inline_link_click: costPerLinkClick,
    inline_link_clicks: linkClicks.toString(),
    frequency: impressions > 0 ? (impressions / parseInt(reach) || 1).toFixed(2) : '1.00',
    actions: leads > 0 ? [
      { action_type: 'offsite_conversion.fb_pixel_lead', value: leads.toString() },
      { action_type: 'link_click', value: clicks.toString() },
      { action_type: 'landing_page_view', value: Math.floor(clicks * 0.7).toString() },
    ] : [
      { action_type: 'link_click', value: clicks.toString() },
    ],
    cost_per_action_type: leads > 0 ? [
      { action_type: 'offsite_conversion.fb_pixel_lead', value: costPerLead },
      { action_type: 'link_click', value: cpc },
    ] : [
      { action_type: 'link_click', value: cpc },
    ],
    date_start: overrides.date,
    date_stop: overrides.date,
  };
}

export function generateMockChatData() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // Generate last 7 days
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  // Campaign A — "Lead Gen - Retargeting" — strong, consistent
  // Campaign B — "Broad Prospecting - US" — HIGH SPEND, DECLINING CONVERSIONS (problem campaign)
  // Campaign C — "Instagram Stories Test" — new, low volume

  const campaigns = [
    { id: '120211001', name: 'Lead Gen - Retargeting' },
    { id: '120211002', name: 'Broad Prospecting - US' },
    { id: '120211003', name: 'Instagram Stories Test' },
  ];

  const adsets = [
    { id: '230001', name: 'Retarget - Website Visitors 30d', campaignId: '120211001' },
    { id: '230002', name: 'Retarget - Engaged FB/IG 14d', campaignId: '120211001' },
    { id: '230003', name: 'Broad - Interest: Business', campaignId: '120211002' },
    { id: '230004', name: 'Broad - Lookalike 1% Leads', campaignId: '120211002' },
    { id: '230005', name: 'IG Stories - Carousel', campaignId: '120211003' },
  ];

  const ads = [
    { id: '340001', name: 'Testimonial Video v2', adsetId: '230001' },
    { id: '340002', name: 'Case Study Static', adsetId: '230001' },
    { id: '340003', name: 'Social Proof Carousel', adsetId: '230002' },
    { id: '340004', name: 'Pain Point Hook v1', adsetId: '230003' },
    { id: '340005', name: 'Pain Point Hook v2', adsetId: '230003' },
    { id: '340006', name: 'Lookalike - Hero Image', adsetId: '230004' },
    { id: '340007', name: 'Stories - Product Demo', adsetId: '230005' },
  ];

  // Today's data — Campaign B has problems (high spend, few leads, rising CPC)
  const todayCampaigns: MockInsightRow[] = [
    makeRow({ campaign_id: '120211001', campaign_name: 'Lead Gen - Retargeting', spend: '85.20', impressions: '12400', clicks: '310', leads: 18, date: todayStr }),
    makeRow({ campaign_id: '120211002', campaign_name: 'Broad Prospecting - US', spend: '245.60', impressions: '48000', clicks: '420', leads: 4, date: todayStr }), // Problem: $245 spend, only 4 leads
    makeRow({ campaign_id: '120211003', campaign_name: 'Instagram Stories Test', spend: '32.10', impressions: '8200', clicks: '175', leads: 3, date: todayStr }),
  ];

  // Yesterday's data — Campaign B was fine yesterday!
  const yesterdayCampaigns: MockInsightRow[] = [
    makeRow({ campaign_id: '120211001', campaign_name: 'Lead Gen - Retargeting', spend: '78.50', impressions: '11800', clicks: '295', leads: 16, date: yesterdayStr }),
    makeRow({ campaign_id: '120211002', campaign_name: 'Broad Prospecting - US', spend: '220.30', impressions: '52000', clicks: '580', leads: 14, date: yesterdayStr }), // Was getting 14 leads yesterday
    makeRow({ campaign_id: '120211003', campaign_name: 'Instagram Stories Test', spend: '28.40', impressions: '7500', clicks: '160', leads: 2, date: yesterdayStr }),
  ];

  // Today's ad sets
  const todayAdSets: MockInsightRow[] = [
    makeRow({ adset_id: '230001', adset_name: 'Retarget - Website Visitors 30d', campaign_id: '120211001', spend: '52.30', impressions: '7800', clicks: '195', leads: 12, date: todayStr }),
    makeRow({ adset_id: '230002', adset_name: 'Retarget - Engaged FB/IG 14d', campaign_id: '120211001', spend: '32.90', impressions: '4600', clicks: '115', leads: 6, date: todayStr }),
    makeRow({ adset_id: '230003', adset_name: 'Broad - Interest: Business', campaign_id: '120211002', spend: '145.20', impressions: '28000', clicks: '240', leads: 2, date: todayStr }), // Problem ad set
    makeRow({ adset_id: '230004', adset_name: 'Broad - Lookalike 1% Leads', campaign_id: '120211002', spend: '100.40', impressions: '20000', clicks: '180', leads: 2, date: todayStr }), // Also bad
    makeRow({ adset_id: '230005', adset_name: 'IG Stories - Carousel', campaign_id: '120211003', spend: '32.10', impressions: '8200', clicks: '175', leads: 3, date: todayStr }),
  ];

  // Yesterday's ad sets
  const yesterdayAdSets: MockInsightRow[] = [
    makeRow({ adset_id: '230001', adset_name: 'Retarget - Website Visitors 30d', campaign_id: '120211001', spend: '48.10', impressions: '7200', clicks: '180', leads: 10, date: yesterdayStr }),
    makeRow({ adset_id: '230002', adset_name: 'Retarget - Engaged FB/IG 14d', campaign_id: '120211001', spend: '30.40', impressions: '4600', clicks: '115', leads: 6, date: yesterdayStr }),
    makeRow({ adset_id: '230003', adset_name: 'Broad - Interest: Business', campaign_id: '120211002', spend: '130.20', impressions: '30000', clicks: '340', leads: 8, date: yesterdayStr }),
    makeRow({ adset_id: '230004', adset_name: 'Broad - Lookalike 1% Leads', campaign_id: '120211002', spend: '90.10', impressions: '22000', clicks: '240', leads: 6, date: yesterdayStr }),
    makeRow({ adset_id: '230005', adset_name: 'IG Stories - Carousel', campaign_id: '120211003', spend: '28.40', impressions: '7500', clicks: '160', leads: 2, date: yesterdayStr }),
  ];

  // Today's ads
  const todayAds: MockInsightRow[] = [
    makeRow({ ad_id: '340001', ad_name: 'Testimonial Video v2', adset_id: '230001', campaign_id: '120211001', spend: '30.50', impressions: '4500', clicks: '120', leads: 8, date: todayStr }),
    makeRow({ ad_id: '340002', ad_name: 'Case Study Static', adset_id: '230001', campaign_id: '120211001', spend: '21.80', impressions: '3300', clicks: '75', leads: 4, date: todayStr }),
    makeRow({ ad_id: '340003', ad_name: 'Social Proof Carousel', adset_id: '230002', campaign_id: '120211001', spend: '32.90', impressions: '4600', clicks: '115', leads: 6, date: todayStr }),
    makeRow({ ad_id: '340004', ad_name: 'Pain Point Hook v1', adset_id: '230003', campaign_id: '120211002', spend: '82.30', impressions: '16000', clicks: '130', leads: 1, date: todayStr }), // Bad ad
    makeRow({ ad_id: '340005', ad_name: 'Pain Point Hook v2', adset_id: '230003', campaign_id: '120211002', spend: '62.90', impressions: '12000', clicks: '110', leads: 1, date: todayStr }), // Also bad
    makeRow({ ad_id: '340006', ad_name: 'Lookalike - Hero Image', adset_id: '230004', campaign_id: '120211002', spend: '100.40', impressions: '20000', clicks: '180', leads: 2, date: todayStr }),
    makeRow({ ad_id: '340007', ad_name: 'Stories - Product Demo', adset_id: '230005', campaign_id: '120211003', spend: '32.10', impressions: '8200', clicks: '175', leads: 3, date: todayStr }),
  ];

  // Yesterday's ads
  const yesterdayAds: MockInsightRow[] = [
    makeRow({ ad_id: '340001', ad_name: 'Testimonial Video v2', adset_id: '230001', campaign_id: '120211001', spend: '28.20', impressions: '4200', clicks: '110', leads: 7, date: yesterdayStr }),
    makeRow({ ad_id: '340002', ad_name: 'Case Study Static', adset_id: '230001', campaign_id: '120211001', spend: '19.90', impressions: '3000', clicks: '70', leads: 3, date: yesterdayStr }),
    makeRow({ ad_id: '340003', ad_name: 'Social Proof Carousel', adset_id: '230002', campaign_id: '120211001', spend: '30.40', impressions: '4600', clicks: '115', leads: 6, date: yesterdayStr }),
    makeRow({ ad_id: '340004', ad_name: 'Pain Point Hook v1', adset_id: '230003', campaign_id: '120211002', spend: '75.10', impressions: '17000', clicks: '200', leads: 5, date: yesterdayStr }),
    makeRow({ ad_id: '340005', ad_name: 'Pain Point Hook v2', adset_id: '230003', campaign_id: '120211002', spend: '55.10', impressions: '13000', clicks: '140', leads: 3, date: yesterdayStr }),
    makeRow({ ad_id: '340006', ad_name: 'Lookalike - Hero Image', adset_id: '230004', campaign_id: '120211002', spend: '90.10', impressions: '22000', clicks: '240', leads: 6, date: yesterdayStr }),
    makeRow({ ad_id: '340007', ad_name: 'Stories - Product Demo', adset_id: '230005', campaign_id: '120211003', spend: '28.40', impressions: '7500', clicks: '160', leads: 2, date: yesterdayStr }),
  ];

  // Account totals
  const todayAccount = [makeRow({ spend: '362.90', impressions: '68600', clicks: '905', leads: 25, date: todayStr })];
  const yesterdayAccount = [makeRow({ spend: '327.20', impressions: '71300', clicks: '1035', leads: 32, date: yesterdayStr })];

  // Hourly data — campaign-level, broken down by hour
  // Campaign A: steady through the day
  // Campaign B: spend ramping but leads dead after morning (problem!)
  // Campaign C: light spend, only active afternoon
  const makeHourlyRow = (hour: number, campaignId: string, campaignName: string, spend: number, impressions: number, clicks: number, leads: number, date: string): MockInsightRow => ({
    ...makeRow({ campaign_id: campaignId, campaign_name: campaignName, spend: spend.toFixed(2), impressions: impressions.toString(), clicks: clicks.toString(), leads, date }),
    hourly_stats_aggregated_by_advertiser_time_zone: `${hour.toString().padStart(2, '0')}:00:00`,
  });

  const todayHourly: MockInsightRow[] = [];
  const yesterdayHourly: MockInsightRow[] = [];

  // Current hour (simulate data up to now)
  const currentHour = now.getHours();

  // Campaign A hourly — consistent performer, ~$5-7/hr, 1-2 leads/hr
  for (let h = 0; h <= Math.min(currentHour, 23); h++) {
    const spend = h < 6 ? 1.5 : (5 + Math.random() * 2);
    const impr = h < 6 ? 200 : (800 + Math.floor(Math.random() * 300));
    const clicks = Math.floor(impr * 0.025);
    const leads = h < 6 ? 0 : (Math.random() > 0.4 ? Math.ceil(Math.random() * 2) : 0);
    todayHourly.push(makeHourlyRow(h, '120211001', 'Lead Gen - Retargeting', spend, impr, clicks, leads, todayStr));
  }

  // Campaign B hourly — got 2 leads in morning hours, then NOTHING despite heavy spend
  for (let h = 0; h <= Math.min(currentHour, 23); h++) {
    const spend = h < 6 ? 3 : (15 + Math.random() * 8); // Heavy spend all day
    const impr = h < 6 ? 500 : (3000 + Math.floor(Math.random() * 1000));
    const clicks = Math.floor(impr * 0.009); // CTR dropping
    const leads = h === 8 ? 2 : (h === 10 ? 1 : (h === 11 ? 1 : 0)); // Only 4 leads, all before noon
    todayHourly.push(makeHourlyRow(h, '120211002', 'Broad Prospecting - US', spend, impr, clicks, leads, todayStr));
  }

  // Campaign C hourly — only started at 10am, light spend
  for (let h = 10; h <= Math.min(currentHour, 23); h++) {
    const spend = 2 + Math.random() * 3;
    const impr = 500 + Math.floor(Math.random() * 300);
    const clicks = Math.floor(impr * 0.02);
    const leads = h === 13 ? 1 : (h === 16 ? 1 : (h === 18 ? 1 : 0));
    todayHourly.push(makeHourlyRow(h, '120211003', 'Instagram Stories Test', spend, impr, clicks, leads, todayStr));
  }

  // Yesterday hourly — Campaign B was performing WELL (for comparison)
  for (let h = 0; h <= 23; h++) {
    // Campaign A — similar to today
    const aSpend = h < 6 ? 1.2 : (4.5 + Math.random() * 2);
    const aImpr = h < 6 ? 180 : (750 + Math.floor(Math.random() * 200));
    const aClicks = Math.floor(aImpr * 0.025);
    const aLeads = h < 6 ? 0 : (Math.random() > 0.35 ? 1 : 0);
    yesterdayHourly.push(makeHourlyRow(h, '120211001', 'Lead Gen - Retargeting', aSpend, aImpr, aClicks, aLeads, yesterdayStr));

    // Campaign B — was getting steady leads all day yesterday!
    const bSpend = h < 6 ? 2.5 : (12 + Math.random() * 5);
    const bImpr = h < 6 ? 400 : (2800 + Math.floor(Math.random() * 600));
    const bClicks = Math.floor(bImpr * 0.011); // Better CTR yesterday
    const bLeads = h < 6 ? 0 : (h % 2 === 0 ? 1 : (Math.random() > 0.5 ? 1 : 0)); // Steady ~1/hr
    yesterdayHourly.push(makeHourlyRow(h, '120211002', 'Broad Prospecting - US', bSpend, bImpr, bClicks, bLeads, yesterdayStr));

    // Campaign C — started later yesterday too
    if (h >= 11) {
      const cSpend = 1.5 + Math.random() * 2;
      const cImpr = 400 + Math.floor(Math.random() * 200);
      const cClicks = Math.floor(cImpr * 0.02);
      const cLeads = h === 14 ? 1 : (h === 17 ? 1 : 0);
      yesterdayHourly.push(makeHourlyRow(h, '120211003', 'Instagram Stories Test', cSpend, cImpr, cClicks, cLeads, yesterdayStr));
    }
  }

  // Age/gender breakdown — mobile 25-34 women convert best
  const ageGender: MockInsightRow[] = [
    makeRow({ age: '18-24', gender: 'female', spend: '45.20', impressions: '9500', clicks: '120', leads: 2, date: todayStr }),
    makeRow({ age: '18-24', gender: 'male', spend: '38.10', impressions: '8200', clicks: '95', leads: 1, date: todayStr }),
    makeRow({ age: '25-34', gender: 'female', spend: '95.40', impressions: '18000', clicks: '280', leads: 10, date: todayStr }), // Best segment
    makeRow({ age: '25-34', gender: 'male', spend: '72.30', impressions: '14000', clicks: '195', leads: 6, date: todayStr }),
    makeRow({ age: '35-44', gender: 'female', spend: '52.80', impressions: '9500', clicks: '110', leads: 4, date: todayStr }),
    makeRow({ age: '35-44', gender: 'male', spend: '35.10', impressions: '6200', clicks: '65', leads: 1, date: todayStr }),
    makeRow({ age: '45-54', gender: 'female', spend: '15.00', impressions: '2200', clicks: '25', leads: 1, date: todayStr }),
    makeRow({ age: '45-54', gender: 'male', spend: '9.00', impressions: '1000', clicks: '15', leads: 0, date: todayStr }),
  ];

  // Device breakdown
  const device: MockInsightRow[] = [
    makeRow({ device_platform: 'mobile_app', spend: '248.50', impressions: '48000', clicks: '680', leads: 19, date: todayStr }),
    makeRow({ device_platform: 'desktop', spend: '85.30', impressions: '15000', clicks: '185', leads: 5, date: todayStr }),
    makeRow({ device_platform: 'mobile_web', spend: '29.10', impressions: '5600', clicks: '40', leads: 1, date: todayStr }),
  ];

  // Publisher breakdown
  const publisher: MockInsightRow[] = [
    makeRow({ publisher_platform: 'facebook', spend: '210.40', impressions: '38000', clicks: '520', leads: 14, date: todayStr }),
    makeRow({ publisher_platform: 'instagram', spend: '120.30', impressions: '24000', clicks: '340', leads: 9, date: todayStr }),
    makeRow({ publisher_platform: 'audience_network', spend: '32.20', impressions: '6600', clicks: '45', leads: 2, date: todayStr }),
  ];

  return {
    date: { today: todayStr, yesterday: yesterdayStr },
    optimizationMap: {
      '120211001': 'offsite_conversion.fb_pixel_lead',
      '120211002': 'offsite_conversion.fb_pixel_lead',
      '120211003': 'offsite_conversion.fb_pixel_start_trial',
    },
    today: {
      campaigns: todayCampaigns,
      adSets: todayAdSets,
      ads: todayAds,
      account: todayAccount,
      hourly: todayHourly,
    },
    yesterday: {
      campaigns: yesterdayCampaigns,
      adSets: yesterdayAdSets,
      ads: yesterdayAds,
      account: yesterdayAccount,
      hourly: yesterdayHourly,
    },
    breakdowns: {
      ageGender: ageGender,
      device: device,
      publisher: publisher,
    },
  };
}
