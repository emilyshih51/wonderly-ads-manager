/** The minimal response returned after posting a Slack message. */
export interface SlackMessage {
  /** Slack message timestamp — used as a unique message ID and for threading. */
  ts: string;
  /** Channel ID where the message was posted. */
  channel: string;
}

/** A single message in a Slack thread, normalized for use as chat history. */
export interface SlackThreadMessage {
  /** Whether the message was sent by the user or the bot assistant. */
  role: 'user' | 'assistant';
  /** Plain-text content of the message. */
  text: string;
}

/**
 * A Slack Block Kit block.
 * Typed loosely because the full Block Kit spec is large and version-dependent.
 * @see https://api.slack.com/reference/block-kit/blocks
 */
export type SlackBlock = Record<string, unknown>;

/** The set of actions a Slack bot message can suggest to the user. */
export type ActionBlockType =
  | 'pause_campaign'
  | 'resume_campaign'
  | 'pause_ad_set'
  | 'resume_ad_set'
  | 'pause_ad'
  | 'resume_ad'
  | 'adjust_budget';

/** A suggested action rendered as a button in a Slack message. */
export interface ActionBlock {
  /** The type of action to suggest to the user. */
  type: ActionBlockType;
  /** Meta object ID (campaign, ad set, or ad) the action targets. */
  id: string;
  /** Human-readable name displayed on the button label. */
  name: string;
  /** New daily budget in dollars — only required for `adjust_budget`. */
  budget?: number;
}

/**
 * Payload for an automation rule action notification.
 * Used by `sendAutomationNotification()` to post rich action results to Slack.
 */
export interface AutomationNotification {
  /** Human-readable rule name shown in the notification header. */
  ruleName: string;
  /** Action that was taken: `'pause'`, `'activate'`, or `'promote'`. */
  actionType: 'pause' | 'activate' | 'promote';
  /** Entity type that was acted on (e.g. `'ad'`, `'adset'`). */
  entityType: string;
  /** Meta object ID of the entity. */
  entityId: string;
  /** Display name of the entity. */
  entityName: string;
  /** Ad account ID (numeric, without `act_` prefix) used to build the Ads Manager link. */
  adAccountId: string;
  /** Metrics snapshot at the time the rule fired. */
  metrics: {
    spend: number;
    results: number;
    cost_per_result: number;
    clicks?: number;
    ctr?: number;
  };
  /** Optional custom message template with `{placeholder}` tokens. */
  customMessage?: string;
  /** Optional ID of a newly created duplicate ad (for promote actions). */
  duplicatedAdId?: string;
  /** Optional prefix string (used in tests to identify test messages). */
  prefix?: string;
}

/**
 * Payload for a budget change notification.
 * Used by `sendBudgetNotification()` to post budget update alerts.
 */
export interface BudgetNotification {
  /** Display name of the entity whose budget changed. */
  entityName: string;
  /** New daily budget in dollars. */
  newBudget: number;
  /** Previous daily budget in dollars, if known. */
  previousBudget?: number;
}

/**
 * Payload for an ad set launch notification.
 * Used by `sendLaunchNotification()` to post launch alerts.
 */
export interface LaunchNotification {
  /** Display name of the launched ad set. */
  adsetName: string;
  /** Pre-formatted budget string (e.g. `"$50.00/day"`). */
  budget: string;
  /** Number of ads created in the ad set. */
  adCount: number;
  /** Human-readable status label (e.g. `"Active"` or `"Paused (draft)"`). */
  status: string;
  /** Optional custom message template with `{adset_name}`, `{budget}`, `{ad_count}`, `{status}` placeholders. */
  customMessage?: string;
}

/** A single entity entry in a budget run summary. */
export interface BudgetChangeSummaryItem {
  /** Display name of the campaign or ad set. */
  entityName: string;
  /** New daily budget in dollars after the adjustment. */
  newBudget: number;
}

/**
 * Payload for a grouped end-of-cron-run budget change summary.
 * Used by `sendBudgetRunSummary()` to post a batched budget change message.
 */
export interface BudgetRunSummary {
  /** Whether all changes in this batch were increases or decreases. */
  direction: 'increase' | 'decrease';
  /** All entities whose budgets changed in this direction during the run. */
  changes: BudgetChangeSummaryItem[];
  /** The time the cron run completed. Defaults to now. */
  runTime?: Date;
}
