import type { ReactElement } from 'react'
import { NotePlus, Plus } from '@/components/icons'
import { chatToMarkdown, createNoteWithTitle } from '@reflect/core'
import { useState } from 'react'
import { ShortcutKeys } from '@/components/shortcut-keys'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/toast'
import { keybindingFor } from '@/lib/commands/app-commands'
import { useChatSession } from '@/providers/chat-provider'
import { conversationTitle } from '@/providers/chat-title'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'
import { ChatHistoryMenu } from './chat-history-menu'
import { ChatInstructionsMenu } from './chat-instructions-menu'

const NEW_CHAT_BINDING = keybindingFor('chat.new')

/**
 * The chat's top bar: which conversation is open on the left, and the
 * conversation-level controls on the right — instructions, history, save as
 * note, new chat.
 *
 * These lived in the composer's bottom row, which put "leave this
 * conversation" next to "send this message" and pushed both under a growing
 * draft. The mobile Chat tab already carried them in its header; this is the
 * same arrangement for the desktop screen and the context rail, and the one
 * every chat app has trained people to reach for in the top-right corner.
 */
export function ChatHeader(): ReactElement {
  const { turns, status, newChat } = useChatSession()
  const { graph } = useGraph()
  const { navigate } = useRouter()
  const [savingNote, setSavingNote] = useState(false)
  const streaming = status === 'streaming'
  const settled = turns.length > 0 && !streaming

  // Export the transcript as a regular note and open it. The note is a copy —
  // the conversation stays in the chat history untouched.
  const saveAsNote = async (): Promise<void> => {
    if (graph === null || savingNote) {
      return
    }
    setSavingNote(true)
    try {
      const noteTitle = `Chat — ${conversationTitle(turns[0]?.userText ?? '')}`
      const path = await createNoteWithTitle(noteTitle, graph.generation, chatToMarkdown(turns))
      navigate({ kind: 'note', path })
    } catch {
      toast.add({ type: 'error', title: 'Could not save the chat as a note' })
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <header className="flex h-10 flex-none items-center gap-1 border-b border-border px-2.5">
      {/* The label stays "Chat", as on the mobile tab: a title derived from
          the first message would sit directly above that same message. */}
      <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">Chat</h2>
      <ChatInstructionsMenu />
      {settled ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Save chat as note"
                disabled={savingNote}
                onClick={() => void saveAsNote()}
              >
                <NotePlus aria-hidden />
              </Button>
            }
          />
          <TooltipContent side="bottom">Save chat as note</TooltipContent>
        </Tooltip>
      ) : null}
      <ChatHistoryMenu />
      {turns.length > 0 ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New chat"
                disabled={streaming}
                onClick={newChat}
              >
                <Plus aria-hidden />
              </Button>
            }
          />
          <TooltipContent side="bottom">
            New chat {NEW_CHAT_BINDING ? <ShortcutKeys binding={NEW_CHAT_BINDING} /> : null}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </header>
  )
}
