import { describe, it, expect, vi } from 'vitest';
import { SlackService } from '@/services/slack';
import crypto from 'crypto';

const BOT_TOKEN = 'xoxb-test-token';
const SIGNING_SECRET = 'test-signing-secret';

function makeFetch(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(data),
  });
}

function makeSignature(secret: string, timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', secret).update(base).digest('hex');

  return `v0=${hmac}`;
}

describe('SlackService', () => {
  describe('verifySignature()', () => {
    it('returns true for a valid signature', () => {
      const svc = new SlackService(BOT_TOKEN, SIGNING_SECRET);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = 'payload=test';
      const sig = makeSignature(SIGNING_SECRET, timestamp, body);

      expect(svc.verifySignature(sig, timestamp, body)).toBe(true);
    });

    it('returns false when signature is wrong', () => {
      const svc = new SlackService(BOT_TOKEN, SIGNING_SECRET);
      const timestamp = String(Math.floor(Date.now() / 1000));

      expect(svc.verifySignature('v0=bad', timestamp, 'body')).toBe(false);
    });

    it('returns false when timestamp is older than 5 minutes', () => {
      const svc = new SlackService(BOT_TOKEN, SIGNING_SECRET);
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400);
      const body = 'payload=test';
      const sig = makeSignature(SIGNING_SECRET, oldTimestamp, body);

      expect(svc.verifySignature(sig, oldTimestamp, body)).toBe(false);
    });

    it('returns false when no signing secret is configured', () => {
      const svc = new SlackService(BOT_TOKEN, '');

      expect(svc.verifySignature('v0=anything', '12345', 'body')).toBe(false);
    });
  });

  describe('postMessage()', () => {
    it('sends correct Authorization header and body', async () => {
      const fetchFn = makeFetch({ ok: true, ts: '12345.678', channel: 'C123' });
      const svc = new SlackService(BOT_TOKEN, SIGNING_SECRET, fetchFn);

      const result = await svc.postMessage('C123', 'Hello!');

      expect(result).toEqual({ ts: '12345.678', channel: 'C123' });
      const [url, options] = fetchFn.mock.calls[0] as [string, RequestInit];

      expect(url).toBe('https://slack.com/api/chat.postMessage');
      expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${BOT_TOKEN}`);
      const body = JSON.parse(options.body as string);

      expect(body.channel).toBe('C123');
      expect(body.text).toBe('Hello!');
    });

    it('includes thread_ts when provided', async () => {
      const fetchFn = makeFetch({ ok: true, ts: '1', channel: 'C1' });
      const svc = new SlackService(BOT_TOKEN, SIGNING_SECRET, fetchFn);

      await svc.postMessage('C1', 'reply', undefined, '999.000');

      const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);

      expect(body.thread_ts).toBe('999.000');
    });

    it('returns null when Slack API responds with ok: false', async () => {
      const fetchFn = makeFetch({ ok: false, error: 'channel_not_found' });
      const svc = new SlackService(BOT_TOKEN, SIGNING_SECRET, fetchFn);

      const result = await svc.postMessage('bad-channel', 'Hi');

      expect(result).toBeNull();
    });

    it('returns null when no bot token is configured', async () => {
      const svc = new SlackService('', SIGNING_SECRET);
      const result = await svc.postMessage('C1', 'Hi');

      expect(result).toBeNull();
    });
  });

  describe('updateMessage()', () => {
    it('calls chat.update with correct params', async () => {
      const fetchFn = makeFetch({ ok: true });
      const svc = new SlackService(BOT_TOKEN, SIGNING_SECRET, fetchFn);

      const result = await svc.updateMessage('C1', '12345.0', 'Updated text');

      expect(result).toBe(true);
      const [url] = fetchFn.mock.calls[0] as [string];

      expect(url).toBe('https://slack.com/api/chat.update');
    });
  });

  describe('parseActions() [static]', () => {
    it('parses valid action blocks', () => {
      const text =
        'Some analysis.\n:::action{"type":"pause_campaign","id":"123","name":"Camp A"}:::\n:::action{"type":"adjust_budget","id":"456","name":"Camp B","budget":500}:::';

      const actions = SlackService.parseActions(text);

      expect(actions).toHaveLength(2);
      expect(actions[0]).toEqual({ type: 'pause_campaign', id: '123', name: 'Camp A' });
      expect(actions[1]).toEqual({ type: 'adjust_budget', id: '456', name: 'Camp B', budget: 500 });
    });

    it('skips malformed action blocks without throwing', () => {
      const text = ':::action{invalid json}:::';

      expect(() => SlackService.parseActions(text)).not.toThrow();
      expect(SlackService.parseActions(text)).toHaveLength(0);
    });

    it('returns empty array when no actions present', () => {
      expect(SlackService.parseActions('Just plain text.')).toHaveLength(0);
    });
  });

  describe('stripActions() [static]', () => {
    it('removes action blocks from text', () => {
      const text = 'Pause this. :::action{"type":"pause_ad","id":"1","name":"Ad"}:::';

      expect(SlackService.stripActions(text)).toBe('Pause this.');
    });
  });

  describe('formatForSlack() [static]', () => {
    it('converts **bold** to *bold*', () => {
      expect(SlackService.formatForSlack('**hello**')).toBe('*hello*');
    });

    it('converts ### headers to *header*', () => {
      expect(SlackService.formatForSlack('### My Header')).toBe('*My Header*');
    });

    it('converts list dashes to bullets', () => {
      expect(SlackService.formatForSlack('- item')).toBe('• item');
    });
  });

  describe('buildBlocks() [static]', () => {
    it('returns section blocks for text', () => {
      const blocks = SlackService.buildBlocks('Hello world', []);

      expect(blocks[0]).toMatchObject({ type: 'section', text: { type: 'mrkdwn' } });
    });

    it('adds action buttons when actions are provided', () => {
      const actions = [{ type: 'pause_campaign' as const, id: '1', name: 'Camp A' }];
      const blocks = SlackService.buildBlocks('Text', actions, 'C1', '999');
      const actionBlock = blocks.find((b) => (b as Record<string, unknown>).type === 'actions');

      expect(actionBlock).toBeDefined();
    });

    it('embeds channelId and threadTs in button values', () => {
      const actions = [{ type: 'pause_ad' as const, id: '42', name: 'My Ad' }];
      const blocks = SlackService.buildBlocks('Text', actions, 'CHAN', 'TS');
      const actionBlock = blocks.find(
        (b) => (b as Record<string, unknown>).type === 'actions'
      ) as Record<string, unknown>;
      const elements = actionBlock!.elements as Array<Record<string, unknown>>;
      const value = JSON.parse(elements[0].value as string);

      expect(value.channel_id).toBe('CHAN');
      expect(value.thread_ts).toBe('TS');
    });
  });
});
