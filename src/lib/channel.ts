/**
 * Acquisition channels — the dimension that splits the marketing funnel beyond the
 * existing binary FB / not-FB view.
 *
 * `wonderly_daily` already carries an `_FB` and an `_ORGANIC` column for every funnel
 * step, where "organic" means only "no Facebook signal" — it lumps SEO, LLM referrals,
 * partner/press referrals and direct traffic into one bucket. These channels refine that
 * bucket so SEO can be tracked down the funnel on its own, while keeping `fb` byte-for-byte
 * identical to the existing `is_fb` rule. That identity matters: the per-channel counts on
 * the SEO tabs sum back to the `wonderly_daily` totals, so the two views always reconcile.
 *
 * Classification is a first-match-wins ladder evaluated per event (see `channelSql` in the
 * Snowflake service):
 *   1. `fb`       — the session carried a Facebook signal (utm_source facebook/ig or an fbclid)
 *   2. `ai`       — first touch came from an LLM surface (ChatGPT, Perplexity, Claude, Gemini, Copilot)
 *   3. `seo`      — first touch was a search-engine referrer AND no campaign utm was present
 *   4. `other`    — first touch carried some other campaign utm (partner lists, job boards, Substack)
 *   5. `direct`   — no first-touch referrer at all, or an internal wonderly.com hop
 *   6. `referral` — any other external referring domain
 *
 * `fb` is judged on the *session* (that is the existing rule, and paid clicks always carry
 * their signal in-session); every other channel is judged on FIRST TOUCH
 * (`initial_utm_source` / `initial_referrer`, both Amplitude `$setOnce` properties). That
 * asymmetry is deliberate: an SEO visitor who leaves and returns by typing the URL is still
 * an SEO visitor, and last-touch would silently reassign them to `direct`.
 */

/** The acquisition channels a marketing event / deal can be attributed to. */
export const CHANNELS = ['seo', 'ai', 'direct', 'referral', 'other', 'fb'] as const;

export type Channel = (typeof CHANNELS)[number];

/** Human-readable label per channel, for tab headers and the Definitions glossary. */
export const CHANNEL_LABELS: Record<Channel, string> = {
  seo: 'Organic search',
  ai: 'AI search',
  direct: 'Direct',
  referral: 'Referral',
  other: 'Other campaign',
  fb: 'Facebook (paid)',
};

/** Column-name prefix per channel on the SEO Funnel tab (e.g. `SEO_SESSIONS`). */
export const CHANNEL_PREFIX: Record<Channel, string> = {
  seo: 'SEO',
  ai: 'AI',
  direct: 'DIRECT',
  referral: 'REFERRAL',
  other: 'OTHER',
  fb: 'FB',
};

/** Narrow an arbitrary string from Snowflake to a Channel, defaulting to `direct`. */
export function toChannel(value: unknown): Channel {
  const s = String(value ?? '').toLowerCase();

  return (CHANNELS as readonly string[]).includes(s) ? (s as Channel) : 'direct';
}

/**
 * One day of one channel's funnel, as returned by `SnowflakeService.getChannelFunnel`.
 *
 * Long format — one row per (date, channel) with any activity — rather than a wide row per
 * day, so adding a channel never changes the shape. `computeSeoMetrics` pivots it.
 *
 * Keying matches the blended tabs: `sessions` / `cta` / `submitPartial` / `submitQualified`
 * are FLOW metrics on the event day; `booked` is keyed to the lead's QUALIFIED day; `held`,
 * `noShow` and `accepted` are COHORT metrics keyed to the deal's booking day.
 */
export interface ChannelFunnelRow {
  /** `YYYY-MM-DD`, bucketed on the report timezone. */
  date: string;
  channel: Channel;
  /** Unique people with a page view that day. */
  sessions: number;
  cta: number;
  submitPartial: number;
  submitQualified: number;
  /** Marketing-qualified leads who booked, keyed to their QUALIFIED day. */
  booked: number;
  /** Of that day's bookings, how many eventually held. Matures over ~30 days. */
  held: number;
  noShow: number;
  /** Of that day's bookings, how many were eventually accepted. Matures over ~30 days. */
  accepted: number;
}
