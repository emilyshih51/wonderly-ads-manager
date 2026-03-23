/** Supported digest frequency types. */
export type DigestType = 'daily' | 'weekly' | 'monthly';

/** Configuration for sending a digest. */
export interface DigestConfig {
  /** Digest frequency — determines date range and heading. */
  type: DigestType;
  /** Slack channel IDs to post the digest to. */
  channelIds: string[];
  /** Ad account IDs to include (without `act_` prefix). */
  accountIds: string[];
  /** Meta system access token. */
  metaSystemToken: string;
}

/** Result of a single-channel digest post attempt. */
export interface DigestChannelResult {
  channelId: string;
  /** Slack message timestamp if the post succeeded. */
  messageTs?: string;
  error?: string;
}

/** Aggregate result for a digest send across all configured channels. */
export interface DigestResult {
  type: DigestType;
  channels: DigestChannelResult[];
}
