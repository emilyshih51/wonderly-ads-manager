export interface MessageParam {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatParams {
  /** The user's message */
  message: string;
  /** System prompt defining AI persona and instructions */
  systemPrompt: string;
  /** Optional data context appended to the system prompt */
  context?: string;
  /** Prior conversation history */
  history?: MessageParam[];
}

export interface CompleteParams {
  /** The user's message */
  message: string;
  /** System prompt defining AI persona and instructions */
  systemPrompt: string;
  /** Optional data context appended to the system prompt */
  context?: string;
  /** Prior conversation history */
  history?: MessageParam[];
}

export interface IAnthropicService {
  chat(params: ChatParams): Promise<ReadableStream>;
  complete(params: CompleteParams): Promise<string>;
}
