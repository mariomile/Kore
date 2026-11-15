import { useState, type ReactElement, type ReactNode } from 'react'
import { chatStarterPrompts } from '@kore/core'
import { CalendarDays, ChevronDown, Flag, Sparkles, Sun, type Icon } from '@/components/icons'
import { useAiPrompts } from '@/hooks/use-ai-prompts'
import { hapticImpactLight } from '@/mobile/haptics'
import { useChatSession } from '@/providers/chat-provider'

interface ChatSuggestion {
  /** The complete question, sent as written: each works on any vault. */
  text: string
  icon: Icon
}

export const CHAT_SUGGESTIONS: readonly ChatSuggestion[] = [
  { text: 'Summarize my week', icon: CalendarDays },
  { text: 'What should I focus on today?', icon: Sun },
  { text: 'Which follow-ups am I missing?', icon: Flag },
]

/** Saved prompts listed before the rest fold behind "Show N more". */
const PROMPTS_VISIBLE = 3

interface MobileChatSuggestionsProps {
  /** Focus the composer after a saved prompt fills it. */
  onPromptPicked: () => void
}

/**
 * The Chat tab's empty transcript, in Craft's register: plain sections of
 * icon + label rows, no cards and no rules, resting on the composer where a
 * thumb already is. "Suggestions" are complete questions a tap sends, the
 * same `send` the composer's button calls. "Your prompts" are the saved
 * prompts that stand on their own ({@link chatStarterPrompts}); a tap fills
 * the composer instead of sending, because a saved prompt is a starting point
 * the user usually finishes (a name, a project, a date).
 */
export function MobileChatSuggestions({
  onPromptPicked,
}: MobileChatSuggestionsProps): ReactElement {
  const { send, setDraft } = useChatSession()
  const { prompts } = useAiPrompts()
  const starters = chatStarterPrompts(prompts)
  const [showAllPrompts, setShowAllPrompts] = useState(false)
  const hiddenPrompts = starters.length - PROMPTS_VISIBLE
  const visiblePrompts = showAllPrompts ? starters : starters.slice(0, PROMPTS_VISIBLE)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2"
      style={{
        paddingTop: 'calc(var(--mobile-header-height, 1rem) + 1rem)',
        paddingBottom:
          'calc(var(--chat-composer-height, 6rem) + var(--mobile-tab-bar-height, 0px) + 0.75rem)',
      }}
    >
      {/* `mt-auto`, not `justify-end`: the list rests on the composer, but
          when it outgrows a short screen its top stays reachable by scroll
          (a justify-end overflow clips the head where no scroll reaches). */}
      <SuggestionSection title="Suggestions" className="mt-auto">
        {CHAT_SUGGESTIONS.map((suggestion) => (
          <SuggestionRow
            key={suggestion.text}
            icon={suggestion.icon}
            label={suggestion.text}
            onClick={() => {
              hapticImpactLight()
              void send(suggestion.text)
            }}
          />
        ))}
      </SuggestionSection>
      {starters.length > 0 ? (
        <SuggestionSection title="Your prompts" className="mt-5">
          {visiblePrompts.map((prompt) => (
            <SuggestionRow
              key={prompt.id}
              icon={Sparkles}
              label={prompt.label}
              onClick={() => {
                hapticImpactLight()
                setDraft(prompt.body)
                onPromptPicked()
              }}
            />
          ))}
          {hiddenPrompts > 0 ? (
            <li>
              <button
                type="button"
                aria-expanded={showAllPrompts}
                onClick={() => setShowAllPrompts((shown) => !shown)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-base text-text-muted active:bg-surface-hover"
              >
                <ChevronDown
                  aria-hidden
                  className="size-5 shrink-0 transition-transform duration-200 ease-swift motion-reduce:transition-none data-[open]:rotate-180"
                  data-open={showAllPrompts ? '' : undefined}
                />
                {showAllPrompts ? 'Show less' : `Show ${hiddenPrompts} more`}
              </button>
            </li>
          ) : null}
        </SuggestionSection>
      ) : null}
    </div>
  )
}

function SuggestionSection({
  title,
  className,
  children,
}: {
  title: string
  className?: string
  children: ReactNode
}): ReactElement {
  return (
    <section className={className} aria-label={title}>
      <h2 className="px-3 pb-1 text-base font-semibold text-text">{title}</h2>
      <ul className="flex flex-col">{children}</ul>
    </section>
  )
}

function SuggestionRow({
  icon: RowIcon,
  label,
  onClick,
}: {
  icon: Icon
  label: string
  onClick: () => void
}): ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-base text-text-secondary transition-colors duration-150 ease-swift active:bg-surface-hover active:text-text"
      >
        <RowIcon aria-hidden className="size-5 shrink-0 text-text-muted" />
        <span className="min-w-0 truncate">{label}</span>
      </button>
    </li>
  )
}
