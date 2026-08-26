import type { ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listChatConversations } from '@reflect/core'
import { Chat, Close, NoteEdit } from '@/components/icons'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { keybindingFor } from '@/lib/commands/app-commands'
import { formatRecencyLabel } from '@/lib/dates'
import { CHAT_QUERY_SCOPE } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useChatSession } from '@/providers/chat-provider'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { useRouter } from '@/routing/router'
import { SidebarItem } from './sidebar-item'

/**
 * The Chat rail: what the workspace sidebar shows while the Chat surface is
 * selected. A New chat action on top, then every persisted conversation of
 * the open graph, newest first — selecting one loads it into the chat screen,
 * the hover `×` deletes it. The same query the history dropdown uses keeps
 * both surfaces on one list.
 */
export function SidebarChatSection(): ReactElement {
  const { graph, indexGeneration } = useGraph()
  const { settings } = useSettings()
  const { route, navigate } = useRouter()
  const { activeConversationId, openConversation, deleteConversation, newChat } = useChatSession()

  const bridgeReady = useBridgeReady()
  const enabled = bridgeReady && indexGeneration !== null
  const { data: conversations } = useQuery({
    // The graph root is part of the key: conversations belong to one graph,
    // and a graph switch must never serve the previous graph's cached list.
    queryKey: [CHAT_QUERY_SCOPE, 'conversations', graph?.root],
    queryFn: () => listChatConversations(),
    enabled,
  })

  const openChatScreen = (): void => {
    if (route.kind !== 'chat') {
      navigate({ kind: 'chat' })
    }
  }

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <nav aria-label="Chat" className="flex-none space-y-1 px-2">
        <SidebarItem
          icon={<NoteEdit className="size-3.5" />}
          label="New chat"
          binding={keybindingFor('chat.new') ?? undefined}
          onClick={() => {
            newChat()
            openChatScreen()
          }}
        />
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <h2 className="pt-4 text-2xs font-medium leading-5 tracking-wide text-text-muted">Chats</h2>
        {conversations === undefined || conversations.length === 0 ? (
          <p className="mt-1 px-2 text-xs leading-5 text-text-muted">No past chats</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {conversations.map((conversation) => {
              const current = route.kind === 'chat' && conversation.id === activeConversationId
              return (
                <li key={conversation.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (conversation.id !== activeConversationId) {
                        void openConversation(conversation.id).then(openChatScreen)
                        return
                      }
                      openChatScreen()
                    }}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 pr-7 text-left text-xs',
                      current
                        ? 'bg-surface-active font-medium text-text'
                        : 'text-text-secondary hover:bg-surface-hover',
                    )}
                  >
                    <Chat aria-hidden className="size-3.5 shrink-0 text-text-muted" />
                    <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                    <span className="shrink-0 text-2xs tabular-nums text-text-muted">
                      {formatRecencyLabel(conversation.updatedMs, settings)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete “${conversation.title}”`}
                    onClick={() => void deleteConversation(conversation.id)}
                    className="absolute right-1.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded text-text-muted opacity-0 transition-[color,background-color,opacity] duration-150 ease-swift hover:bg-surface-active hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Close aria-hidden className="size-3" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
