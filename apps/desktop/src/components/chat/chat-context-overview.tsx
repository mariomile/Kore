import type { ReactElement } from 'react'
import { conversationContextNotes } from '@kore/core'
import { SidebarSection } from '@/components/context-sidebar/sidebar-section'
import { useOptionalChatSession } from '@/providers/chat-context'
import { ContextNoteRow } from './chat-context-sources'

/**
 * The Details panel on the chat route: every note this conversation has
 * carried as context, once each — the running tally of what Kore read, where
 * each reply's own pill only covers that reply. Empty until a turn brings a
 * note along, and then it says what will appear here instead of framing a
 * blank card.
 */
export function ChatContextOverview(): ReactElement {
  const session = useOptionalChatSession()
  const notes = conversationContextNotes(session?.turns ?? [])

  if (notes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-text-muted">
        Notes this chat reads show up here.
      </div>
    )
  }

  return (
    <div className="py-2">
      <SidebarSection storageKey="chat-context" title="Notes in this chat">
        <ul className="flex flex-col">
          {notes.map((note) => (
            <li key={note.path} className="min-w-0">
              <ContextNoteRow note={note} />
            </li>
          ))}
        </ul>
      </SidebarSection>
    </div>
  )
}
