import { describe, it, expect } from 'vitest';
import { configToNodes, nodesToConfig, type RuleConfig } from '@/lib/automation-config';

/** Minimal valid promote config with multiple comma-separated target ad sets. */
function makePromoteConfig(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return {
    entity_type: 'ad',
    campaign_id: 'camp-1',
    campaign_name: 'Prospecting',
    adset_filter: 'all',
    adset_name: '',
    schedule: 'hourly',
    date_preset: 'last_7d',
    conditions: [{ id: 'c1', metric: 'cost_per_result', operator: '<=', threshold: '200' }],
    action_type: 'promote',
    target_adset_id: 'adset-a,adset-b,adset-c',
    target_adset_name: 'Winners US,Winners CA,Winners UK',
    pause_original: false,
    protect_converters: true,
    also_notify_slack: true,
    slack_channel: '#ad-promotion',
    slack_message: '',
    ...overrides,
  };
}

describe('automation-config promote multi-target serialization', () => {
  it('preserves comma-separated target ad sets through config → nodes → config', () => {
    const config = makePromoteConfig();
    const { nodes } = configToNodes(config);
    const roundTripped = nodesToConfig(nodes);

    expect(roundTripped.target_adset_id).toBe('adset-a,adset-b,adset-c');
    expect(roundTripped.target_adset_name).toBe('Winners US,Winners CA,Winners UK');
    expect(roundTripped.action_type).toBe('promote');
    expect(roundTripped.pause_original).toBe(false);
  });

  it('stores the target ad sets on the action node config', () => {
    const { nodes } = configToNodes(makePromoteConfig());
    const action = nodes.find((n) => n.type === 'action');

    expect(action?.data.config.target_adset_id).toBe('adset-a,adset-b,adset-c');
  });

  it('splits a comma-separated target list into individual ad set IDs', () => {
    const { nodes } = configToNodes(makePromoteConfig());
    const action = nodes.find((n) => n.type === 'action');
    const ids = String(action?.data.config.target_adset_id ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    expect(ids).toEqual(['adset-a', 'adset-b', 'adset-c']);
  });

  it('remains backward compatible with a single target ad set', () => {
    const config = makePromoteConfig({
      target_adset_id: 'adset-only',
      target_adset_name: 'Winners',
    });
    const roundTripped = nodesToConfig(configToNodes(config).nodes);

    expect(roundTripped.target_adset_id).toBe('adset-only');
    const ids = roundTripped.target_adset_id.split(',').filter(Boolean);

    expect(ids).toHaveLength(1);
  });
});

describe('protect_converters round-trip', () => {
  it('survives a config → nodes → config round trip when on', () => {
    const config = makePromoteConfig({ protect_converters: true });

    expect(nodesToConfig(configToNodes(config).nodes).protect_converters).toBe(true);
  });

  it('survives a config → nodes → config round trip when off', () => {
    const config = makePromoteConfig({ protect_converters: false });

    expect(nodesToConfig(configToNodes(config).nodes).protect_converters).toBe(false);
  });

  it('defaults to true for rules saved before the field existed', () => {
    const { nodes } = configToNodes(makePromoteConfig());
    const action = nodes.find((n) => n.type === 'action');

    // Simulate a legacy stored rule: strip the field entirely.
    delete (action!.data.config as Record<string, unknown>).protect_converters;

    expect(nodesToConfig(nodes).protect_converters).toBe(true);
  });
});
