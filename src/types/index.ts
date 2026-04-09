// ─── Meta API Types ───────────────────────────────────────────────────────────

/** Delivery status common to campaigns, ad sets, and ads. */
export type MetaEntityStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';

/** A Meta (Facebook) ad campaign. */
export interface MetaCampaign {
  /** Unique campaign ID assigned by Meta. */
  id: string;
  /** Display name of the campaign. */
  name: string;
  /** Delivery status of the campaign. */
  status: MetaEntityStatus;
  /** Campaign objective (e.g. `OUTCOME_LEADS`, `OUTCOME_SALES`). */
  objective: string;
  /** Daily budget in the account currency, as a string (Meta returns budgets as strings). */
  daily_budget?: string;
  /** Lifetime budget in the account currency, as a string. */
  lifetime_budget?: string;
  /** ISO 8601 creation timestamp. */
  created_time: string;
  /** ISO 8601 last-updated timestamp. */
  updated_time: string;
  /** Aggregated performance data for the selected date range. */
  insights?: MetaInsights;
}

/** A Meta ad set belonging to a campaign. */
export interface MetaAdSet {
  /** Unique ad set ID assigned by Meta. */
  id: string;
  /** Display name of the ad set. */
  name: string;
  /** ID of the parent campaign. */
  campaign_id: string;
  /** Minimal campaign object — present when the `campaign` field is requested. */
  campaign?: { name: string };
  /** Delivery status of the ad set. */
  status: MetaEntityStatus;
  /** Daily budget in the account currency, as a string. */
  daily_budget?: string;
  /** Lifetime budget in the account currency, as a string. */
  lifetime_budget?: string;
  /** Targeting spec (age, geo, interests, etc.). Shape varies by ad type. */
  targeting?: Record<string, unknown>;
  /** Optimization goal (e.g. `LINK_CLICKS`, `LEAD_GENERATION`). */
  optimization_goal?: string;
  /** Billing event (e.g. `IMPRESSIONS`, `LINK_CLICKS`). */
  billing_event?: string;
  /** Bid cap in the account currency, as a string. */
  bid_amount?: string;
  /** ISO 8601 scheduled start time. */
  start_time?: string;
  /** ISO 8601 scheduled end time. */
  end_time?: string;
  /** ISO 8601 creation timestamp. */
  created_time: string;
  /** ISO 8601 last-updated timestamp. */
  updated_time: string;
  /** Aggregated performance data for the selected date range. */
  insights?: MetaInsights;
}

/** A single Meta ad belonging to an ad set. */
export interface MetaAd {
  /** Unique ad ID assigned by Meta. */
  id: string;
  /** Display name of the ad. */
  name: string;
  /** ID of the parent ad set. */
  adset_id: string;
  /** ID of the parent campaign. */
  campaign_id: string;
  /** Delivery status of the ad. */
  status: MetaEntityStatus;
  /** Creative asset attached to this ad. */
  creative?: MetaAdCreative;
  /** ISO 8601 creation timestamp. */
  created_time: string;
  /** ISO 8601 last-updated timestamp. */
  updated_time: string;
  /** Aggregated performance data for the selected date range. */
  insights?: MetaInsights;
}

/** Creative asset associated with a Meta ad. */
export interface MetaAdCreative {
  /** Unique creative ID assigned by Meta. */
  id: string;
  /** Display name of the creative. */
  name: string;
  /** Ad headline / title text. */
  title?: string;
  /** Primary ad copy body text. */
  body?: string;
  /** URL of the image used in the creative. */
  image_url?: string;
  /** Hash of the uploaded image (used when creating new creatives). */
  image_hash?: string;
  /** ID of the video asset for video ads. */
  video_id?: string;
  /** Destination URL the ad links to. */
  link_url?: string;
  /** Call-to-action button type (e.g. `LEARN_MORE`, `SIGN_UP`). */
  call_to_action_type?: string;
  /** Full object story spec for link-page post creatives. Shape is Meta-defined. */
  object_story_spec?: Record<string, unknown>;
  /** Thumbnail URL for video creatives. */
  thumbnail_url?: string;
  /** Rendered image URL returned by Meta for both image and video ads. */
  effective_image_url?: string;
}

/** Aggregated performance metrics returned by the Meta Insights API. */
export interface MetaInsights {
  /** Total amount spent in the account currency, as a string. */
  spend: string;
  /** Total impressions delivered. */
  impressions: string;
  /** Total link clicks. */
  clicks: string;
  /** Click-through rate (clicks ÷ impressions), as a percentage string. */
  ctr: string;
  /** Cost per click in the account currency, as a string. */
  cpc: string;
  /** Cost per 1 000 impressions in the account currency, as a string. */
  cpm: string;
  /** Unique accounts that saw the ad. */
  reach: string;
  /** Breakdown of conversion actions (purchases, leads, etc.). */
  actions?: MetaAction[];
  /** Cost per each conversion action type. */
  cost_per_action_type?: MetaAction[];
  /** Start of the reporting date range (YYYY-MM-DD). */
  date_start: string;
  /** End of the reporting date range (YYYY-MM-DD). */
  date_stop: string;
}

/** A single action event returned by the Meta Insights API. */
export interface MetaAction {
  /** Action type identifier (e.g. `lead`, `purchase`, `link_click`). */
  action_type: string;
  /**
   * Number of times this action occurred, as a string.
   * When `action_attribution_windows` is requested, this reflects the count for the
   * `default_attribution_window` (we set this to `7d_click`). Per-window breakdown
   * values are attached as additional string keys (e.g. `7d_click`, `1d_view`).
   */
  value: string;
  /** Per-window breakdown values attached by Meta when action_attribution_windows is requested. */
  [window: string]: string;
}

/**
 * A single row from a filtered Meta insights query (used by the automation engine).
 * Contains ID/name fields for the entity level plus core performance metrics.
 */
export interface MetaInsightsRow {
  /** Ad ID — present when `level=ad`. */
  ad_id?: string;
  /** Ad name — present when `level=ad`. */
  ad_name?: string;
  /** Ad set ID — present when `level=ad` or `level=adset`. */
  adset_id?: string;
  /** Ad set name — present when `level=adset`. */
  adset_name?: string;
  /** Campaign ID — present at all levels. */
  campaign_id?: string;
  /** Campaign name — present when `level=campaign` or `level=adset`. */
  campaign_name?: string;
  /** Total spend in the account currency, as a string. */
  spend: string;
  /** Total impressions delivered. */
  impressions: string;
  /** Total link clicks. */
  clicks: string;
  /** Click-through rate as a percentage string. */
  ctr: string;
  /** Link click-through rate (link clicks ÷ impressions), as a percentage string. */
  inline_link_click_ctr?: string;
  /** Cost per click as a string. */
  cpc: string;
  /** Cost per 1 000 impressions as a string. */
  cpm: string;
  /** Unique accounts reached. */
  reach?: string;
  /** Average frequency. */
  frequency?: string;
  /** Breakdown of conversion actions. */
  actions?: MetaAction[];
  /** Cost per each conversion action type. */
  cost_per_action_type?: MetaAction[];
  /** Start of the reporting date range (YYYY-MM-DD). */
  date_start?: string;
  /** End of the reporting date range (YYYY-MM-DD). */
  date_stop?: string;
}

/** Daily performance metrics for a single time-series data point. */
export interface MetaInsightsTimeSeries {
  /** Start of the day's date range (YYYY-MM-DD). */
  date_start: string;
  /** End of the day's date range (YYYY-MM-DD). */
  date_stop: string;
  /** Amount spent on this day in the account currency, as a string. */
  spend: string;
  /** Impressions delivered on this day. */
  impressions: string;
  /** Clicks recorded on this day. */
  clicks: string;
  /** Click-through rate on this day, as a percentage string. */
  ctr: string;
  /** Cost per click on this day, as a string. */
  cpc: string;
  /** Cost per 1 000 impressions on this day, as a string. */
  cpm: string;
  /** Conversion actions recorded on this day. */
  actions?: MetaAction[];
}

// ─── Automation Types ─────────────────────────────────────────────────────────

/** A user-defined automation rule composed of a visual flow of nodes and edges. */
export interface AutomationRule {
  /** Unique rule ID (UUID). */
  id: string;
  /** ID of the user who owns this rule. */
  user_id: string;
  /** Human-readable rule name shown in the UI. */
  name: string;
  /** Whether this rule is currently evaluated by the cron job. */
  is_active: boolean;
  /** Ordered list of flow nodes (triggers, conditions, actions). */
  nodes: AutomationNode[];
  /** Directed edges connecting the nodes. */
  edges: AutomationEdge[];
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 last-updated timestamp. */
  updated_at: string;
}

/** A single node in an automation flow graph. */
export interface AutomationNode {
  /** Unique node ID within the flow. */
  id: string;
  /** Node category that determines how it is evaluated. */
  type: 'trigger' | 'condition' | 'action';
  /** Canvas position used by the flow editor. */
  position: { x: number; y: number };
  /** Display and configuration data for this node. */
  data: {
    /** Label shown on the node card in the editor. */
    label: string;
    /** Node-specific configuration values (metric thresholds, action targets, etc.). */
    config: Record<string, unknown>;
  };
}

/** A directed edge connecting two nodes in an automation flow. */
export interface AutomationEdge {
  /** Unique edge ID within the flow. */
  id: string;
  /** ID of the source node. */
  source: string;
  /** ID of the target node. */
  target: string;
  /** Output handle on the source node (e.g. `true` / `false` branches). */
  sourceHandle?: string;
  /** Input handle on the target node. */
  targetHandle?: string;
}

// ─── Slack Types ──────────────────────────────────────────────────────────────

/** Persisted Slack workspace integration for a user. */
export interface SlackConnection {
  /** Unique connection record ID. */
  id: string;
  /** ID of the user who connected this workspace. */
  user_id: string;
  /** Slack workspace team ID. */
  team_id: string;
  /** Slack workspace display name. */
  team_name: string;
  /** Default channel ID where bot messages are posted. */
  channel_id: string;
  /** Human-readable name of the default channel. */
  channel_name: string;
  /** Bot OAuth access token — never expose to the client. */
  access_token: string;
  /** Incoming webhook URL for the connected channel. */
  webhook_url?: string;
  /** ISO 8601 timestamp when the connection was created. */
  created_at: string;
}

// ─── User / Session ───────────────────────────────────────────────────────────

/** Authenticated user data stored in the encrypted session cookie. */
export interface UserSession {
  /** Unique user ID (Meta user ID used as primary key). */
  id: string;
  /** User's email address from their Meta account. */
  email: string;
  /** User's display name from their Meta account. */
  name: string;
  /** Short-lived Meta user access token — never expose to the client. */
  meta_access_token: string;
  /** Meta user ID associated with the access token. */
  meta_user_id: string;
  /** Selected Meta ad account ID (format: `act_<number>`). */
  ad_account_id: string;
}

// ─── Dashboard Types ──────────────────────────────────────────────────────────

/** Aggregated KPI metrics displayed on the main dashboard. */
export interface DashboardMetrics {
  /** Total amount spent in the account currency. */
  amount_spent: number;
  /** Cost per 1 000 impressions. */
  cpm: number;
  /** Click-through rate as a decimal (e.g. `0.023` = 2.3 %). */
  ctr: number;
  /** Cost per click in the account currency. */
  cpc: number;
  /** Total number of optimization-goal results (leads, purchases, etc.). */
  results: number;
  /** Cost per result, or `null` when there are zero results. */
  cost_per_result: number | null;
}
