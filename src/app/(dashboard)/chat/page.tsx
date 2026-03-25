'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Send,
  Loader2,
  Bot,
  User,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Zap,
  Check,
  Copy,
  MessageSquarePlus,
  ChevronDown,
} from 'lucide-react';
import {
  useChatEngine,
  SUGGESTED_PROMPTS,
  FOLLOW_UP_PROMPTS,
  COLOR_HEX,
} from '@/hooks/use-chat-engine';

/** Pricing per million tokens (Claude Sonnet). */
const INPUT_COST_PER_M = 3.0;
const OUTPUT_COST_PER_M = 15.0;

/**
 * Displays token usage summary for an assistant message.
 * @param usage - Token usage object with input_tokens and output_tokens
 */
function TokenSummary({ usage }: { usage: { input_tokens: number; output_tokens: number } }) {
  const [expanded, setExpanded] = useState(false);
  const total = usage.input_tokens + usage.output_tokens;
  const cost =
    (usage.input_tokens / 1_000_000) * INPUT_COST_PER_M +
    (usage.output_tokens / 1_000_000) * OUTPUT_COST_PER_M;

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="mt-1.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)]/50"
    >
      <ChevronDown
        className={`h-3 w-3 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
      />
      <span>
        {total.toLocaleString()} tokens &middot; ~${cost.toFixed(4)}
      </span>
      {expanded && (
        <span className="ml-auto text-[10px] tabular-nums opacity-70">
          {usage.input_tokens.toLocaleString()} in &middot; {usage.output_tokens.toLocaleString()}{' '}
          out
        </span>
      )}
    </button>
  );
}

export default function ChatPage() {
  const engine = useChatEngine();
  const {
    messages,
    input,
    setInput,
    isLoading,
    dataLoading,
    dataError,
    copiedId,
    dataStats,
    showFollowUps,
    messagesEndRef,
    inputRef,
    resetChat,
    copyMessage,
    sendMessage,
    handleKeyDown,
    fetchData,
    formatContent,
    renderActionCard,
  } = engine;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-[100dvh]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 sm:px-6 md:px-8 md:py-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-[var(--color-foreground)] md:text-xl">
            Ad Performance Chat
          </h1>
          <p className="mt-0.5 hidden text-sm text-[var(--color-muted-foreground)] sm:block">
            Ask anything about your Meta Ads performance
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={resetChat} className="shrink-0">
            <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">New Chat</span>
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* Empty state */
          <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
            <div className="mb-10 text-center">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/20 md:h-16 md:w-16">
                <Sparkles className="h-7 w-7 text-white md:h-8 md:w-8" />
              </div>
              <h2 className="mb-2 text-xl font-bold text-[var(--color-foreground)] md:text-2xl">
                Ask anything about your ads
              </h2>
              <p className="mx-auto max-w-lg text-sm text-[var(--color-muted-foreground)] md:text-base">
                Powered by Claude with access to your live Meta Ads data — today vs yesterday,
                hourly data, and audience breakdowns.
              </p>

              {dataLoading && (
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading account data...
                </div>
              )}
              {dataError && (
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4" /> {dataError}
                </div>
              )}
              {!dataLoading && dataStats && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted-foreground)]">
                  <span>{dataStats.campaigns} campaigns</span>
                  <span className="hidden sm:inline">·</span>
                  <span>{dataStats.adSets} ad sets</span>
                  <span className="hidden sm:inline">·</span>
                  <span>{dataStats.ads} ads</span>
                  {dataStats.hasYesterday && (
                    <span className="text-green-600 dark:text-green-400">✓ yesterday</span>
                  )}
                  {dataStats.hasHourly && (
                    <span className="text-green-600 dark:text-green-400">✓ hourly</span>
                  )}
                  {dataStats.hasBreakdowns && (
                    <span className="text-green-600 dark:text-green-400">✓ breakdowns</span>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {SUGGESTED_PROMPTS.map((prompt, idx) => {
                const Icon = prompt.icon;
                const hex = COLOR_HEX[prompt.color] || COLOR_HEX.blue;

                return (
                  <button
                    key={idx}
                    onClick={() => sendMessage(prompt.prompt)}
                    disabled={isLoading || dataLoading}
                    className="group flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left transition-all hover:border-[var(--color-primary)]/30 hover:bg-[var(--color-muted)] hover:shadow-sm disabled:opacity-50"
                  >
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${hex}18`, color: hex }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">
                        {prompt.label}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted-foreground)]">
                        {prompt.prompt}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="mx-auto max-w-4xl space-y-5 px-4 py-4 sm:px-6 sm:py-6 md:px-8">
            {messages.map((msg) => (
              <div key={msg.id}>
                <div className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 sm:h-8 sm:w-8">
                      <Bot className="h-3.5 w-3.5 text-white sm:h-4 sm:w-4" />
                    </div>
                  )}
                  <div
                    className={`group/msg relative max-w-[90%] sm:max-w-[85%] ${
                      msg.role === 'user'
                        ? 'rounded-2xl rounded-tr-md bg-[var(--color-primary)] px-4 py-3 text-[var(--color-primary-foreground)]'
                        : 'rounded-2xl rounded-tl-md border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3.5 sm:px-5 sm:py-4'
                    }`}
                  >
                    {/* Copy button — assistant messages only */}
                    {msg.role === 'assistant' && !msg.isLoading && msg.content && (
                      <button
                        onClick={() => copyMessage(msg.id, msg.content)}
                        className="absolute -top-2 -right-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1 opacity-0 shadow-sm transition-opacity group-hover/msg:opacity-100"
                        aria-label="Copy message"
                      >
                        {copiedId === msg.id ? (
                          <Check className="h-3 w-3 text-green-600" />
                        ) : (
                          <Copy className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                        )}
                      </button>
                    )}

                    {/* Content */}
                    {msg.isLoading && !msg.content ? (
                      <div className="flex items-center gap-2">
                        <span className="flex gap-1">
                          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-muted-foreground)] [animation-delay:0ms]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-muted-foreground)] [animation-delay:150ms]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-muted-foreground)] [animation-delay:300ms]" />
                        </span>
                      </div>
                    ) : (
                      <>
                        <div
                          className={`space-y-1 text-sm leading-relaxed ${msg.role === 'user' ? 'text-[var(--color-primary-foreground)]' : 'text-[var(--color-foreground)]'}`}
                        >
                          {formatContent(msg.content)}
                          {msg.isLoading && (
                            <span className="ml-0.5 inline-block h-4 w-1 animate-pulse rounded-full bg-[var(--color-primary)] align-middle" />
                          )}
                        </div>
                        {!msg.isLoading && msg.actions && msg.actions.length > 0 && (
                          <div className="mt-4 space-y-2 border-t border-[var(--color-border)] pt-3">
                            <p className="flex items-center gap-1 text-xs font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
                              <Zap className="h-3 w-3" /> Suggested Actions
                            </p>
                            {msg.actions.map((action, idx) =>
                              renderActionCard(action, msg.id, idx)
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-muted)] sm:h-8 sm:w-8">
                      <User className="h-3.5 w-3.5 text-[var(--color-muted-foreground)] sm:h-4 sm:w-4" />
                    </div>
                  )}
                </div>
                {msg.tokenUsage && !msg.isLoading && <TokenSummary usage={msg.tokenUsage} />}
                {/* Timestamp */}
                <p
                  className={`mt-1 text-[10px] text-[var(--color-muted-foreground)] ${
                    msg.role === 'user' ? 'mr-10 text-right sm:mr-11' : 'ml-10 sm:ml-11'
                  }`}
                >
                  {msg.timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            ))}

            {/* Follow-up suggestions */}
            {showFollowUps && (
              <div className="ml-10 flex flex-wrap gap-1.5 sm:ml-11">
                {FOLLOW_UP_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-xs text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 sm:px-6 md:px-8 md:py-4">
        <div className="mx-auto max-w-4xl">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your ad performance..."
              className="max-h-[120px] min-h-[44px] w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] py-3 pr-12 pl-12 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:border-transparent focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none sm:pr-12 sm:pl-12"
              rows={1}
              disabled={isLoading}
            />
            <button
              onClick={fetchData}
              disabled={dataLoading}
              title="Refresh data"
              className="absolute top-1/2 left-3 -translate-y-1/2 rounded-md p-1 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${dataLoading ? 'animate-spin' : ''}`} />
            </button>
            <Button
              size="icon"
              className="absolute top-1/2 right-2 h-8 w-8 -translate-y-1/2 rounded-lg"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 hidden text-center text-[10px] text-[var(--color-muted-foreground)] sm:block">
            Powered by Claude · Live Meta Ads data
          </p>
        </div>
      </div>
    </div>
  );
}
