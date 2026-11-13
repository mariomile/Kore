import type { ReactElement } from 'react'
import { Chat } from '@/components/icons'
import { hapticImpactLight } from '@/mobile/haptics'
import { useChatSession } from '@/providers/chat-provider'

/** Complete questions, sent as written: each works on any vault. */
export const CHAT_SUGGESTIONS: readonly string[] = [
  'Summarize my week',
  'What should I focus on today?',
  'Which follow-ups am I missing?',
]

/**
 * The Chat tab's empty transcript: a few starter questions above the
 * composer, where a thumb already is. A tap sends the question as written,
 * the same `send` the composer's button calls.
 */
export function MobileChatSuggestions(): ReactElement {
  const { send } = useChatSession()

  return (
    <div
      className="flex min-h-0 flex-1 flex-col justify-end gap-2 px-4"
      style={{
        paddingTop: 'calc(var(--mobile-header-height, 1rem) + 1rem)',
        paddingBottom:
          'calc(var(--chat-composer-height, 6rem) + var(--mobile-tab-bar-height, 0px) + 1rem)',
      }}
    >
      <p className="flex items-center gap-2 pb-1 text-sm text-text-muted">
        <Chat aria-hidden className="size-4" />
        Ask about your notes
      </p>
      <ul className="flex flex-col items-start gap-2" aria-label="Suggested questions">
        {CHAT_SUGGESTIONS.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => {
                hapticImpactLight()
                void send(suggestion)
              }}
              className="min-h-11 rounded-full border border-border bg-surface px-4 text-left text-sm text-text active:bg-surface-hover"
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
