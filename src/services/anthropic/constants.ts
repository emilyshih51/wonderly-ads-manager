export enum ClaudeModel {
  Opus4 = 'claude-opus-4-6',
  Sonnet4 = 'claude-sonnet-4-6',
  Sonnet = 'claude-sonnet-4-20250514',
  Haiku4 = 'claude-haiku-4-5-20251001',
}

export const DEFAULT_MODEL = ClaudeModel.Sonnet;
export const DEFAULT_MAX_TOKENS = 4000;
