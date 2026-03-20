import { describe, it, expect, vi } from 'vitest';
import { MetaService } from '@/services/meta';

function makeFetch(data: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: vi.fn().mockResolvedValue(data),
  });
}

describe('MetaService', () => {
  const TOKEN = 'test-token';
  const ACCOUNT_ID = '123456';

  describe('request()', () => {
    it('appends access_token to URL', async () => {
      const fetchFn = makeFetch({ data: [] });
      const svc = new MetaService(TOKEN, ACCOUNT_ID, fetchFn);

      await svc.request('/act_123/campaigns', { params: { limit: '10' } });

      const calledUrl = new URL(fetchFn.mock.calls[0][0] as string);

      expect(calledUrl.searchParams.get('access_token')).toBe(TOKEN);
      expect(calledUrl.searchParams.get('limit')).toBe('10');
    });

    it('throws MetaApiError when response contains error', async () => {
      const fetchFn = makeFetch({
        error: { message: 'Invalid token', code: 190, error_subcode: 463 },
      });
      const svc = new MetaService(TOKEN, ACCOUNT_ID, fetchFn);

      await expect(svc.request('/me')).rejects.toMatchObject({
        message: 'Invalid token',
        metaError: { code: 190, error_subcode: 463 },
      });
    });

    it('sends JSON body with correct Content-Type for POST', async () => {
      const fetchFn = makeFetch({ id: 'new-campaign' });
      const svc = new MetaService(TOKEN, ACCOUNT_ID, fetchFn);

      await svc.request('/act_123/campaigns', {
        method: 'POST',
        body: { name: 'Test', status: 'PAUSED' },
      });

      const [, options] = fetchFn.mock.calls[0] as [string, RequestInit];

      expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(JSON.parse(options.body as string)).toMatchObject({ name: 'Test', status: 'PAUSED' });
    });
  });

  describe('getCampaigns()', () => {
    it('calls the correct endpoint and returns data', async () => {
      const campaigns = [{ id: '1', name: 'Campaign A' }];
      const fetchFn = makeFetch({ data: campaigns });
      const svc = new MetaService(TOKEN, ACCOUNT_ID, fetchFn);

      const result = await svc.getCampaigns();
      const calledUrl = new URL(fetchFn.mock.calls[0][0] as string);

      expect(calledUrl.pathname).toBe(`/v21.0/act_${ACCOUNT_ID}/campaigns`);
      expect(result).toEqual({ data: campaigns });
    });
  });

  describe('updateStatus()', () => {
    it('POSTs with the correct status body', async () => {
      const fetchFn = makeFetch({ success: true });
      const svc = new MetaService(TOKEN, ACCOUNT_ID, fetchFn);

      await svc.updateStatus('ad-id-999', 'PAUSED');

      const [url, options] = fetchFn.mock.calls[0] as [string, RequestInit];

      expect(url).toContain('/ad-id-999');
      expect((options as RequestInit).method).toBe('POST');
      expect(JSON.parse(options.body as string)).toEqual({ status: 'PAUSED' });
    });
  });

  describe('duplicateAd()', () => {
    it('throws when source ad has no creative', async () => {
      const fetchFn = makeFetch({ id: 'ad-1', name: 'My Ad' });
      const svc = new MetaService(TOKEN, ACCOUNT_ID, fetchFn);

      await expect(svc.duplicateAd('ad-1', 'adset-2')).rejects.toThrow('has no creative');
    });

    it('creates a new ad with [Winner Copy] suffix by default', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        const data =
          callCount === 1
            ? { id: 'ad-1', name: 'Hero Ad', creative: { id: 'creative-99' } }
            : { id: 'new-ad-id' };

        return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
      });

      const svc = new MetaService(TOKEN, ACCOUNT_ID, fetchFn);
      const result = await svc.duplicateAd('ad-1', 'adset-2');

      expect(result).toEqual({ id: 'new-ad-id' });
      const [, createOptions] = fetchFn.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(createOptions.body as string);

      expect(body.name).toBe('Hero Ad [Winner Copy]');
      expect(body.creative.creative_id).toBe('creative-99');
    });
  });

  describe('getCampaignOptimizationMap()', () => {
    it('maps LEAD_GENERATION to correct action type', async () => {
      const fetchFn = makeFetch({
        data: [
          { campaign_id: 'c1', optimization_goal: 'LEAD_GENERATION' },
          {
            campaign_id: 'c2',
            optimization_goal: 'OFFSITE_CONVERSIONS',
            promoted_object: { custom_event_type: 'LEAD' },
          },
        ],
      });
      const svc = new MetaService(TOKEN, ACCOUNT_ID, fetchFn);
      const map = await svc.getCampaignOptimizationMap();

      expect(map['c1']).toBe('onsite_conversion.lead_grouped');
      expect(map['c2']).toBe('offsite_conversion.fb_pixel_lead');
    });
  });
});
