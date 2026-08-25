import type { ReactElement } from 'react'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { useChatSession } from '@/providers/chat-provider'
import { ChatTurn } from './chat-turn'

/**
 * The conversation column: a centered list of turns inside shadcn's chat
 * scroller, which owns scroll anchoring while a response streams.
 */
export function ChatTurnList(): ReactElement {
  const { turns } = useChatSession()

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport className="px-6" aria-label="Chat conversation">
          {turns.length > 0 ? (
            <div className="mx-auto w-full max-w-2xl">
              {/* The chrome floats over the list on both edges, so the
                  content pads past the published heights instead of fixed
                  insets: the mobile glass header above (absent on desktop —
                  the 1rem fallback restores the plain pt-8), and the
                  composer plus, on mobile, the glass tab bar below. */}
              <MessageScrollerContent
                className="gap-6"
                style={{
                  paddingTop: 'calc(var(--mobile-header-height, 1rem) + 1rem)',
                  paddingBottom:
                    'calc(var(--chat-composer-height, 6rem) + var(--mobile-tab-bar-height, 0px) + 1.5rem)',
                }}
              >
                {turns.map((turn) => (
                  // The item's content-visibility paint containment clips at its
                  // padding edge, cutting the copy button's focus ring where the
                  // button sits flush with the turn's left/bottom edge. The
                  // padding moves that clip edge outward; the negative margin
                  // cancels it in layout, so the visual spacing is unchanged.
                  <MessageScrollerItem
                    key={turn.id}
                    messageId={turn.id}
                    scrollAnchor
                    className="-m-1 p-1"
                  >
                    <ChatTurn turn={turn} />
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </div>
          ) : null}
        </MessageScrollerViewport>
        <MessageScrollerButton className="!bottom-[calc(var(--chat-composer-height,6rem)+var(--mobile-tab-bar-height,0px)+1.25rem)]" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
