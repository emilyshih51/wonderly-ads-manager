import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetaInsightsRow } from '@/types';
import { LIFETIME_DATE_PRESET } from '@/lib/automation-utils';

/**
 * Guardrail tests for the automation engine: an ad that has ever converted
 * must never be auto-paused or budget-cut, and a lifetime lookup failure must
 * hold destructive actions back rather than risk killing a converting ad.
 */

const updateStatus = vi.fn();
const updateBudget = vi.fn();
const duplicateAd = vi.fn();
const updateName = vi.fn();
const getBudget = vi.fn();
const getFilteredInsights = vi.fn();
const getAdInsights = vi.fn();

vi.mock('@/lib/session', () => ({
  requireSession: vi.fn().mockResolvedValue({
    id: 'u1',
    email: 'e@example.com',
    name: 'E',
    meta_access_token: 'tok',
    meta_user_id: 'mu1',
    ad_account_id: '123',
  }),
}));

vi.mock('@/services/meta', () => ({
  MetaService: {
    fromSession: () => ({
      getOptimizationMap: vi.fn().mockResolvedValue({ 'adset-1': 'lead' }),
      getFilteredInsights,
      getAdInsights,
      updateStatus,
      updateBudget,
      getBudget,
      duplicateAd,
      updateName,
    }),
  },
}));

vi.mock('@/services/slack', () => ({
  createSlackService: () => ({
    sendAutomationNotification: vi.fn().mockResolvedValue(undefined),
    sendBudgetNotification: vi.fn().mockResolvedValue(undefined),
    sendBudgetRunSummary: vi.fn().mockResolvedValue(undefined),
  }),
}));

const { POST } = await import('@/app/api/automations/evaluate/route');

/** An insight row for a single ad with the given conversion count. */
function adRow(conversions: number, spend = '100'): MetaInsightsRow {
  return {
    ad_id: 'ad-1',
    ad_name: 'Test Ad',
    adset_id: 'adset-1',
    campaign_id: 'camp-1',
    campaign_name: 'Test Campaign',
    spend,
    impressions: '5000',
    clicks: '50',
    ctr: '1',
    cpc: '2',
    cpm: '20',
    actions: conversions > 0 ? [{ action_type: 'lead', value: String(conversions) }] : [],
  } as MetaInsightsRow;
}

/** A pause rule: spend >= $30 in the window, protection on unless overridden. */
function pauseRule(actionConfig: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    name: 'Kill zero-conversion ads',
    active: true,
    nodes: [
      {
        id: 't1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          label: 'Scan',
          config: { entity_type: 'ad', date_preset: 'last_7d', campaign_id: 'camp-1' },
        },
      },
      {
        id: 'c1',
        type: 'condition',
        position: { x: 0, y: 1 },
        data: { label: 'spend', config: { metric: 'spend', operator: '>=', threshold: '30' } },
      },
      {
        id: 'a1',
        type: 'action',
        position: { x: 0, y: 2 },
        data: { label: 'Pause', config: { action_type: 'pause', ...actionConfig } },
      },
    ],
    edges: [],
  };
}

/** Invoke the live (non-dry-run) evaluator for one rule. */
async function evaluate(rule: unknown) {
  const request = new Request('http://localhost/api/automations/evaluate', {
    method: 'POST',
    body: JSON.stringify({ rule, live: true }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await POST(request as any);

  return (await response.json()) as { results: Array<Record<string, unknown>> };
}

/**
 * Wire the two insight queries the engine makes: the rule's own window, and
 * the separate lifetime (`maximum`) query the guardrail depends on.
 */
function mockInsights(windowRows: MetaInsightsRow[], lifetimeRows: MetaInsightsRow[] | Error) {
  getFilteredInsights.mockImplementation(
    (_level: string, options: { datePreset?: string } = {}) => {
      if (options.datePreset === LIFETIME_DATE_PRESET) {
        return lifetimeRows instanceof Error
          ? Promise.reject(lifetimeRows)
          : Promise.resolve(lifetimeRows);
      }

      return Promise.resolve(windowRows);
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getBudget.mockResolvedValue(10000);
  getAdInsights.mockResolvedValue({ data: [] });
});

describe('lifetime-conversion guardrail', () => {
  it('pauses an ad with zero lifetime conversions', async () => {
    mockInsights([adRow(0)], [adRow(0)]);

    const { results } = await evaluate(pauseRule());

    expect(updateStatus).toHaveBeenCalledWith('ad-1', 'PAUSED');
    expect(results[0].action).toBe('paused');
  });

  it('never pauses an ad that has lifetime conversions, even at zero in the window', async () => {
    // Zero results over last_7d — the rule matches — but 4 conversions all-time.
    mockInsights([adRow(0)], [adRow(4)]);

    const { results } = await evaluate(pauseRule());

    expect(updateStatus).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      action: 'skipped',
      skipped: 'has_lifetime_conversions',
      lifetime_results: 4,
      converter_protected: true,
    });
  });

  it('protects on a single lifetime conversion', async () => {
    mockInsights([adRow(0)], [adRow(1)]);

    await evaluate(pauseRule());

    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('confirms an ad missing from the bulk lifetime rows with a single lookup', async () => {
    mockInsights([adRow(0)], []);
    getAdInsights.mockResolvedValue({ data: [] });

    await evaluate(pauseRule());

    expect(getAdInsights).toHaveBeenCalledWith('ad-1', LIFETIME_DATE_PRESET);
    expect(updateStatus).toHaveBeenCalledWith('ad-1', 'PAUSED');
  });

  it('protects an ad missing from the bulk rows whose single lookup shows conversions', async () => {
    // The bulk query dropped this ad (row limit); it has actually converted.
    mockInsights([adRow(0)], []);
    getAdInsights.mockResolvedValue({ data: [adRow(7)] });

    const { results } = await evaluate(pauseRule());

    expect(updateStatus).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      skipped: 'has_lifetime_conversions',
      lifetime_results: 7,
    });
  });

  it('holds the pause back when the single-entity lifetime lookup fails', async () => {
    mockInsights([adRow(0)], []);
    getAdInsights.mockRejectedValue(new Error('rate limited'));

    const { results } = await evaluate(pauseRule());

    expect(updateStatus).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ skipped: 'lifetime_data_unavailable' });
  });

  it('holds the pause back when the lifetime lookup fails', async () => {
    mockInsights([adRow(0)], new Error('Meta API down'));

    const { results } = await evaluate(pauseRule());

    expect(updateStatus).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ skipped: 'lifetime_data_unavailable' });
  });

  it('still pauses a converting ad when the toggle is explicitly off', async () => {
    mockInsights([adRow(0)], [adRow(9)]);

    await evaluate(pauseRule({ protect_converters: 'false' }));

    expect(updateStatus).toHaveBeenCalledWith('ad-1', 'PAUSED');
  });

  it('skips a budget decrease for a converting ad set', async () => {
    mockInsights([adRow(0)], [adRow(3)]);

    const rule = pauseRule({
      action_type: 'adjust_budget',
      adjust_direction: 'decrease',
      adjust_amount_type: 'percent',
      adjust_amount: 20,
    });

    // adjust_budget only applies to ad sets / campaigns.
    (rule.nodes[0].data.config as Record<string, unknown>).entity_type = 'adset';

    const { results } = await evaluate(rule);

    expect(updateBudget).not.toHaveBeenCalled();
    expect(results[0].skipped).toBe('has_lifetime_conversions');
  });

  it('allows a budget increase for a converting ad set', async () => {
    mockInsights([adRow(0)], [adRow(3)]);

    const rule = pauseRule({
      action_type: 'adjust_budget',
      adjust_direction: 'increase',
      adjust_amount_type: 'percent',
      adjust_amount: 20,
    });

    (rule.nodes[0].data.config as Record<string, unknown>).entity_type = 'adset';

    const { results } = await evaluate(rule);

    expect(updateBudget).toHaveBeenCalled();
    expect(results[0].action).toBe('budget_increased');
  });

  it('promotes a converting winner but leaves the original running', async () => {
    mockInsights([adRow(0)], [adRow(6)]);
    duplicateAd.mockResolvedValue({ id: 'dup-1' });

    const { results } = await evaluate(
      pauseRule({
        action_type: 'promote',
        target_adset_id: 'winners-1',
        pause_original: 'true',
      })
    );

    expect(duplicateAd).toHaveBeenCalledWith('ad-1', 'winners-1');
    expect(updateStatus).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      action: 'promoted (original kept active)',
      converter_protected: true,
      lifetime_results: 6,
    });
  });

  it('does not run the extra lifetime query for a non-destructive rule', async () => {
    mockInsights([adRow(0)], [adRow(0)]);

    await evaluate(pauseRule({ action_type: 'activate' }));

    const lifetimeCalls = getFilteredInsights.mock.calls.filter(
      (call) => (call[1] as { datePreset?: string })?.datePreset === LIFETIME_DATE_PRESET
    );

    expect(lifetimeCalls).toHaveLength(0);
    expect(updateStatus).toHaveBeenCalledWith('ad-1', 'ACTIVE');
  });
});

describe('lifetime-window rules (0 conversions + >$X lifetime -> kill)', () => {
  /** The rule Olesya specified: both conditions judged over all time. */
  function lifetimeRule() {
    const rule = pauseRule();

    (rule.nodes[0].data.config as Record<string, unknown>).date_preset = LIFETIME_DATE_PRESET;
    (rule.nodes[1].data.config as Record<string, unknown>).threshold = '300';
    rule.nodes.splice(2, 0, {
      id: 'c2',
      type: 'condition',
      position: { x: 0, y: 1 },
      data: { label: 'results', config: { metric: 'results', operator: '==', threshold: '0' } },
    } as (typeof rule.nodes)[number]);

    return rule;
  }

  it('pauses an ad with $300+ lifetime spend and zero lifetime conversions', async () => {
    mockInsights([adRow(0, '512')], [adRow(0, '512')]);

    const { results } = await evaluate(lifetimeRule());

    expect(updateStatus).toHaveBeenCalledWith('ad-1', 'PAUSED');
    expect(results[0]).toMatchObject({ action: 'paused', date_preset: LIFETIME_DATE_PRESET });
  });

  it('leaves an ad under the lifetime spend threshold alone', async () => {
    mockInsights([adRow(0, '250')], [adRow(0, '250')]);

    await evaluate(lifetimeRule());

    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('leaves an ad with any lifetime conversion alone', async () => {
    mockInsights([adRow(1, '900')], [adRow(1, '900')]);

    await evaluate(lifetimeRule());

    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('reuses the scan instead of issuing a second lifetime query', async () => {
    mockInsights([adRow(0, '512')], [adRow(0, '512')]);

    await evaluate(lifetimeRule());

    // One query total: the rule's own window already is the lifetime window.
    expect(getFilteredInsights).toHaveBeenCalledTimes(1);
    expect(getAdInsights).not.toHaveBeenCalled();
  });
});
