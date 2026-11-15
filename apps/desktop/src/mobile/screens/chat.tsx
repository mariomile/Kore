import { useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Chat, History, Pencil } from '@/components/icons'
import { ChatTurnList } from '@/components/chat/chat-turn-list'
import { Button } from '@/components/ui/button'
import { MobileChatComposer } from '@/mobile/chat-composer'
import { ChatHistoryDrawer } from '@/mobile/chat-history-drawer'
import { MobileChatSuggestions } from '@/mobile/chat-suggestions'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { useChatSession } from '@/providers/chat-provider'
import { conversationTitle } from '@/providers/chat-title'
import { useRouter } from '@/routing/router'
import { hapticImpactLight } from '@/mobile/haptics'

/**
 * The Chat tab (Plan 23): desktop's dedicated chat view as a root tab —
 * the transcript reuses desktop's turn components wholesale (tool chips,
 * settled-markdown citations that navigate), over a mobile composer and
 * bottom-sheet history/model pickers. The conversation and draft live in
 * {@link useChatSession} above the screen, so switching tabs and coming back
 * loses nothing. An empty conversation offers starter questions
 * ({@link MobileChatSuggestions}). With no AI provider configured the tab is one
 * call-to-action into Settings, where keys are added per device.
 */
export function MobileChat(): ReactElement {
  const { providers, turns, newChat } = useChatSession()
  const { navigate } = useRouter()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  const [historyOpen, setHistoryOpen] = useState(false)
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)
  const hasProvider = providers.length > 0
  const title = conversationTitle(turns[0]?.userText ?? '')

  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      {/* Craft-style floating header: three capsules over the content, no
          bar and no rule under it. History leads (the "menu" of past
          conversations), the conversation's name sits in the middle, a new
          chat trails. The side slots keep their width when empty, so the
          title pill never shifts off center. */}
      <header
        ref={barRef}
        className="mobile-pill-header pointer-events-none absolute inset-x-0 top-0 z-30"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 0.25rem)',
          paddingLeft: 'max(env(safe-area-inset-left), 0.75rem)',
          paddingRight: 'max(env(safe-area-inset-right), 0.75rem)',
        }}
      >
        <div className="grid h-12 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-3">
          {hasProvider ? (
            <HeaderPillButton label="Chat history" onClick={() => setHistoryOpen(true)}>
              <History aria-hidden className="size-5" />
            </HeaderPillButton>
          ) : (
            <span aria-hidden />
          )}
          <h1 className="mobile-nav-capsule max-w-full min-w-0 justify-self-center truncate px-4 text-base leading-11 font-semibold text-text">
            {hasProvider ? title : 'Chat'}
          </h1>
          {hasProvider && turns.length > 0 ? (
            <HeaderPillButton label="New chat" onClick={newChat}>
              <Pencil aria-hidden className="size-5" />
            </HeaderPillButton>
          ) : (
            <span aria-hidden />
          )}
        </div>
      </header>
      {hasProvider ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {turns.length > 0 ? (
            <ChatTurnList />
          ) : (
            <MobileChatSuggestions onPromptPicked={() => composerInputRef.current?.focus()} />
          )}
          <MobileChatComposer textareaRef={composerInputRef} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="flex max-w-sm flex-col items-center text-center">
            <Chat aria-hidden className="size-8 text-text-muted" />
            <h2 className="mt-4 text-lg font-semibold text-text">Chat with your notes</h2>
            <p className="mt-2 text-sm text-text-muted">
              Add an AI provider to start chatting. Kore calls the provider directly with your own
              key — it stays in the device keychain, and private notes are never sent.
            </p>
            <Button className="mt-5" onClick={() => navigate({ kind: 'settings' })}>
              Add an AI provider
            </Button>
          </div>
        </div>
      )}
      <ChatHistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  )
}

/** A 44pt round capsule in the header, the tab bar's glass recipe. */
function HeaderPillButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        hapticImpactLight()
        onClick()
      }}
      className="mobile-nav-capsule flex size-11 items-center justify-center text-text transition-transform duration-150 ease-swift active:scale-90 motion-reduce:transition-none"
    >
      {children}
    </button>
  )
}
