/** A single message in a Claude conversation turn. */
export interface MessageParam {
  /** Speaker role for this message. */
  role: 'user' | 'assistant';
  /** Plain-text content of the message. */
  content: string;
}

/** Parameters for a streaming chat call. */
export interface ChatParams {
  /** The user's message to send to Claude. */
  message: string;
  /** System prompt defining the AI persona and task instructions. */
  systemPrompt: string;
  /** Optional data context appended to the system prompt (e.g. serialized Meta API data). */
  context?: string;
  /** Prior conversation turns to maintain continuity. */
  history?: MessageParam[];
}

/** Parameters for a non-streaming completion call. */
export interface CompleteParams {
  /** The user's message to send to Claude. */
  message: string;
  /** System prompt defining the AI persona and task instructions. */
  systemPrompt: string;
  /** Optional data context appended to the system prompt. */
  context?: string;
  /** Prior conversation turns to maintain continuity. */
  history?: MessageParam[];
}
