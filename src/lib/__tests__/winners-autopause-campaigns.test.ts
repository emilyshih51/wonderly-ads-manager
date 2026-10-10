import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const lists = new Map<string, string[]>();
const fakeRedis = {
  get: async (k: string) => store.get(k) ?? null,
  set: async (k: string, v: string) => void store.set(k, v),
  lPush: async (k: string, v: string) => void lists.set(k, [v, ...(lists.get(k) ?? [])]),
  lTrim: async (k: string, a: number, b: number) =>
    void lists.set(k, (lists.get(k) ?? []).slice(a, b + 1)),
  lRange: async (k: string, a: number, b: number) => (lists.get(k) ?? []).slice(a, b + 1),
};

vi.mock('@/lib/redis', () => ({ getRedisClient: async () => fakeRedis }));

const { addCampaign, loadCampaigns, loadChanges, loadSettings, removeCampaign, saveSettings } =
  await import('@/lib/winners-autopause-runner');
const { WINNERS_CAMPAIGN_ID } = await import('@/lib/winners-autopause');

const PPR = {
  id: '120242022304100408',
  name: 'Wonderly | Prospecting | Remodeling Pay Per Results',
};

beforeEach(() => {
  store.clear();
  lists.clear();
});

describe('auto-pause campaigns', () => {
  it('defaults to Winners and Pay Per Results', async () => {
    expect((await loadCampaigns()).map((c) => c.id)).toEqual([WINNERS_CAMPAIGN_ID, PPR.id]);
  });

  it('Pay Per Results follows Winners rules in dry run until it has its own', async () => {
    await saveSettings(WINNERS_CAMPAIGN_ID, { targetCpa: 270, dryRun: false }, 'Emily');

    const { settings } = await loadSettings(PPR.id);

    expect(settings.targetCpa).toBe(270);
    expect(settings.dryRun).toBe(true);
    expect(settings.campaignId).toBe(PPR.id);
  });

  it('Winners keeps the original Redis keys', async () => {
    await saveSettings(WINNERS_CAMPAIGN_ID, { targetCpa: 270 }, 'Emily');

    expect(store.has('winners_autopause:settings')).toBe(true);
    expect((await loadSettings(WINNERS_CAMPAIGN_ID)).settings.targetCpa).toBe(270);
  });

  it('a new campaign copies Winners rules and starts in dry run', async () => {
    await saveSettings(
      WINNERS_CAMPAIGN_ID,
      { targetCpa: 270, dryRun: false, rule2Enabled: false },
      'Emily'
    );
    const OTHER = { id: '999', name: 'Other' };

    await addCampaign(OTHER, 'Emily');

    const { settings } = await loadSettings(OTHER.id);

    expect(settings.campaignId).toBe(OTHER.id);
    expect(settings.targetCpa).toBe(270);
    expect(settings.rule2Enabled).toBe(false);
    expect(settings.dryRun).toBe(true);
    expect(settings.enabled).toBe(true);
    expect((await loadCampaigns()).map((c) => c.id)).toEqual([
      WINNERS_CAMPAIGN_ID,
      PPR.id,
      OTHER.id,
    ]);
  });

  it('campaigns have separate settings and history', async () => {
    await addCampaign(PPR, 'Emily');
    await saveSettings(PPR.id, { targetCpa: 300 }, 'Emily');

    expect((await loadSettings(PPR.id)).settings.targetCpa).toBe(300);
    expect((await loadSettings(WINNERS_CAMPAIGN_ID)).settings.targetCpa).toBe(250);
    expect((await loadChanges(PPR.id)).length).toBeGreaterThan(0);
    expect(await loadChanges(WINNERS_CAMPAIGN_ID)).toHaveLength(0);
  });

  it('removing keeps at least one campaign and keeps settings', async () => {
    await addCampaign(PPR, 'Emily');
    await saveSettings(PPR.id, { targetCpa: 300 }, 'Emily');
    await removeCampaign(PPR.id, 'Emily');

    expect((await loadCampaigns()).map((c) => c.id)).toEqual([WINNERS_CAMPAIGN_ID]);
    await expect(removeCampaign(WINNERS_CAMPAIGN_ID, 'Emily')).rejects.toThrow();

    // Adding back restores its old rules instead of overwriting them
    await addCampaign(PPR, 'Emily');
    expect((await loadSettings(PPR.id)).settings.targetCpa).toBe(300);
  });
});
