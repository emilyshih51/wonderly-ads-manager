export interface SlackMessage {
  ts: string;
  channel: string;
}

export interface SlackThreadMessage {
  role: 'user' | 'assistant';
  text: string;
}

export type SlackBlock = Record<string, unknown>;

export type ActionBlockType =
  | 'pause_campaign'
  | 'resume_campaign'
  | 'pause_ad_set'
  | 'resume_ad_set'
  | 'pause_ad'
  | 'resume_ad'
  | 'adjust_budget';

export interface ActionBlock {
  /** The type of action to suggest to the user */
  type: ActionBlockType;
  /** Meta object ID (campaign, ad set, or ad) */
  id: string;
  /** Human-readable name shown on the button */
  name: string;
  /** New daily budget in dollars (only for `adjust_budget`) */
  budget?: number;
}

export interface ISlackService {
  verifySignature(signature: string, timestamp: string, body: string): boolean;
  postMessage(
    channel: string,
    text: string,
    blocks?: SlackBlock[],
    threadTs?: string
  ): Promise<SlackMessage | null>;
  updateMessage(channel: string, ts: string, text: string, blocks?: SlackBlock[]): Promise<boolean>;
  getThreadMessages(
    channel: string,
    threadTs: string,
    limit?: number
  ): Promise<SlackThreadMessage[]>;
}
