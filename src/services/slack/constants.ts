export const SLACK_API_BASE = 'https://slack.com/api';

export const SLACK_ENDPOINTS = {
  postMessage: `${SLACK_API_BASE}/chat.postMessage`,
  updateMessage: `${SLACK_API_BASE}/chat.update`,
  conversationsReplies: `${SLACK_API_BASE}/conversations.replies`,
  authTest: `${SLACK_API_BASE}/auth.test`,
} as const;

/** Maximum characters per Slack Block Kit section block */
export const SLACK_BLOCK_MAX_CHARS = 2900;

/** Maximum buttons per Slack actions block */
export const SLACK_MAX_BUTTONS_PER_ROW = 5;

/** Maximum characters for an action button label before truncation */
export const ACTION_LABEL_MAX_CHARS = 30;

/** Slack request timestamp freshness window in seconds (5 minutes) */
export const SLACK_TIMESTAMP_TOLERANCE_SECONDS = 300;
