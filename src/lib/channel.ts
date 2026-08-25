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

/**
 * Search engines that get their own channel, and therefore their own column.
 *
 * Every engine with real traffic is here. The long tail — Yandex, Baidu, Ecosia, Startpage,
 * 14 people between them since May 1 — collapses into `other_engine` rather than four
 * columns that read 0 every day. Promote one out of the tail if it ever starts producing.
 */
export const SEARCH_ENGINES = [
  'google',
  'bing',
  'duckduckgo',
  'yahoo',
  'brave',
  'other_engine',
] as const;

export type SearchEngine = (typeof SEARCH_ENGINES)[number];

/** The acquisition channels a marketing event / deal can be attributed to. */
export const CHANNELS = [...SEARCH_ENGINES, 'ai', 'direct', 'referral', 'other', 'fb'] as const;

export type Channel = (typeof CHANNELS)[number];

/** True when a channel is an organic search engine (so it rolls up into Organic). */
export function isSearchEngine(c: ChannelKey): c is SearchEngine {
  return (SEARCH_ENGINES as readonly string[]).includes(c);
}

/**
 * Deals that reach no marketing session at all — outbound, rep-created, or from before
 * tracking. Real acquisitions with no channel, so they are labelled rather than dropped:
 * they belong in the ALL denominator, and excluding them would flatter every channel's share.
 */
export const UNATTRIBUTED = 'unattributed';

/**
 * The synthetic row carrying the whole day, undivided.
 *
 * It is computed at its own grain (a `COUNT(DISTINCT …)` over the undivided day), **not** by
 * summing the channel rows. One person can produce events in two channels on the same day —
 * an `fbclid` on one hit and not the next — so a sum double-counts them and would stop the
 * SEO tab tying out to `wonderly_daily`. Always read this row for a total; never add up
 * the channels.
 */
export const ALL_CHANNELS = 'all';

/** A row key on the channel funnel: one real channel, the unattributed bucket, or the total. */
export type ChannelKey = Channel | typeof UNATTRIBUTED | typeof ALL_CHANNELS;

/** Human-readable label per channel, for tab headers and the Definitions glossary. */
export const CHANNEL_LABELS: Record<Channel, string> = {
  google: 'Google',
  bing: 'Bing',
  duckduckgo: 'DuckDuckGo',
  yahoo: 'Yahoo',
  brave: 'Brave',
  other_engine: 'Other engine',
  ai: 'AI search',
  direct: 'Direct',
  referral: 'Referral',
  other: 'Other campaign',
  fb: 'Facebook',
};

/**
 * Narrow an arbitrary string from Snowflake to a ChannelKey.
 *
 * Unknown values fall back to `unattributed` rather than to a real channel — a row whose
 * channel we can't read must not silently inflate one.
 */
export function toChannel(value: unknown): ChannelKey {
  const s = String(value ?? '').toLowerCase();

  if (s === ALL_CHANNELS || s === UNATTRIBUTED) return s;

  return (CHANNELS as readonly string[]).includes(s) ? (s as Channel) : UNATTRIBUTED;
}

/**
 * One day of one channel's funnel, as returned by `SnowflakeService.getChannelFunnel`.
 *
 * Long format — one row per (date, channel) with any activity — rather than a wide row per
 * day, so adding a channel never changes the shape. `computeSeoMetrics` pivots it.
 *
 * Keying matches the blended tabs: `pageViews` / `cta` / `submitPartial` / `submitQualified`
 * are FLOW metrics on the event day; `booked` is keyed to the lead's QUALIFIED day; `held`,
 * `noShow` and `accepted` are COHORT metrics keyed to the deal's booking day.
 */
export interface ChannelFunnelRow {
  /** `YYYY-MM-DD`, bucketed on the report timezone. */
  date: string;
  /** A real channel, the `unattributed` bucket, or the `all` total row. */
  channel: ChannelKey;
  /**
   * Unique PEOPLE with a marketing page view that day — `COUNT(DISTINCT AMPLITUDE_ID)`, the
   * same measure `wonderly_daily` reports as PAGE_VIEW. Not visits and not page-view events:
   * on 2026-08-25 organic search was 69 people across 78 Amplitude sessions and 131 page views.
   */
  pageViews: number;
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
