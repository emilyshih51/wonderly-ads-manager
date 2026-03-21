'use client';

import { Bot, User, Send, RefreshCw, AlertTriangle, Loader2, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAssistantStore } from '@/stores/assistant-store';
import {
  useChatEngine,
  SUGGESTED_PROMPTS,
  FOLLOW_UP_PROMPTS,
  COLOR_HEX,
} from '@/hooks/use-chat-engine';
import { cn } from '@/lib/utils';

/**
 * Slide-up chat panel anchored above the assistant character.
 * Uses `useChatEngine` for all chat state and streaming logic.
 */
export function AssistantPanel() {
  const { assistantPanelOpen, closeAssistantPanel } = useAssistantStore();

  const {
    messages,
    input,
    setInput,
    isLoading,
    dataLoading,
    dataError,
    dataStats,
    showFollowUps,
    messagesEndRef,
    inputRef,
    sendMessage,
    handleKeyDown,
    fetchData,
    formatContent,
    renderActionCard,
  } = useChatEngine();

  return (
    <div
      className={cn(
        'fixed right-6 bottom-[140px] z-[10000]',
        'flex h-[580px] w-[400px] flex-col',
        'max-sm:inset-x-0 max-sm:bottom-0 max-sm:h-[85vh] max-sm:w-full max-sm:rounded-b-none',
        'rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl',
        'transition-all duration-300 ease-out',
        assistantPanelOpen
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-4 opacity-0'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
            <Bot className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-[var(--color-foreground)]">Assistant</span>
          <span className="text-xs text-[var(--color-muted-foreground)]">· AI Assistant</span>
        </div>
        <button
          onClick={closeAssistantPanel}
          aria-label="Close assistant"
          className="rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          /* Empty state with suggested prompts */
          <div className="space-y-3">
            <div className="py-4 text-center">
              {dataLoading && (
                <div className="flex items-center justify-center gap-2 text-xs text-blue-600 dark:text-blue-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading data...
                </div>
              )}
              {dataError && (
                <div className="flex items-center justify-center gap-1 text-xs text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" /> {dataError}
                </div>
              )}
              {!dataLoading && dataStats && (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {dataStats.campaigns} campaigns · {dataStats.adSets} ad sets · {dataStats.ads} ads
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {SUGGESTED_PROMPTS.slice(0, 4).map((prompt, idx) => {
                const Icon = prompt.icon;
                const hex = COLOR_HEX[prompt.color] || COLOR_HEX.blue;

                return (
                  <button
                    key={idx}
                    onClick={() => sendMessage(prompt.prompt)}
                    disabled={isLoading || dataLoading}
                    className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-2.5 text-left transition-all hover:bg-[var(--color-muted)] disabled:opacity-50"
                  >
                    <div
                      className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
                      style={{ backgroundColor: `${hex}18`, color: hex }}
                    >
                      <Icon className="h-3 w-3" />
                    </div>
                    <p className="text-xs font-medium text-[var(--color-foreground)]">
                      {prompt.label}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* Message thread */
          <div className="space-y-3">
            {messages.map((msg) => (
              <div key={msg.id}>
                <div className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
                      <Bot className="h-3 w-3 text-white" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[85%] rounded-xl px-3 py-2',
                      msg.role === 'user'
                        ? 'rounded-tr-sm bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                        : 'rounded-tl-sm border border-[var(--color-border)] bg-[var(--color-card)]'
                    )}
                  >
                    {msg.isLoading && !msg.content ? (
                      <span className="flex gap-1 py-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-muted-foreground)] [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-muted-foreground)] [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-muted-foreground)] [animation-delay:300ms]" />
                      </span>
                    ) : (
                      <>
                        <div className="space-y-0.5 text-xs leading-relaxed">
                          {formatContent(msg.content)}
                          {msg.isLoading && (
                            <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse rounded-full bg-[var(--color-primary)] align-middle" />
                          )}
                        </div>
                        {!msg.isLoading && msg.actions && msg.actions.length > 0 && (
                          <div className="mt-2 space-y-1.5 border-t border-[var(--color-border)] pt-2">
                            <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
                              <Zap className="h-2.5 w-2.5" /> Actions
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
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-muted)]">
                      <User className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Follow-up chips */}
            {showFollowUps && (
              <div className="ml-8 flex flex-wrap gap-1">
                {FOLLOW_UP_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1 text-[10px] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
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
      <div className="border-t border-[var(--color-border)] p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your campaigns..."
              rows={1}
              disabled={isLoading}
              className="max-h-[80px] min-h-[36px] w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] py-2 pr-2 pl-3 text-xs text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:border-transparent focus:ring-1 focus:ring-[var(--color-primary)] focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Button
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
            <button
              onClick={fetchData}
              disabled={dataLoading}
              title="Refresh data"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${dataLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
