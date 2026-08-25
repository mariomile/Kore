import { useEffect, type RefObject } from 'react'
import { errorMessage, listChatConversations, loadChatMessages, type ChatTurn } from '@reflect/core'

/** Resume the latest conversation within this window; otherwise start fresh. */
const CHAT_IDLE_CUTOFF_MS = 6 * 60 * 60 * 1000

/**
 * Resume the latest conversation on mount — unless it has been idle past
 * the cutoff (then the next message starts a fresh one and the old chat
 * stays in the history). Guarded against races: by the time the rows
 * arrive the user may have started typing into the fresh conversation.
 */
export function useChatConversationRestore(args: {
  bridgeReady: boolean
  indexGeneration: number | null
  sessionRef: RefObject<number>
  turnsRef: RefObject<ChatTurn[]>
  setConversationId: (id: string) => void
  setTurns: (turns: ChatTurn[]) => void
}): void {
  const { bridgeReady, indexGeneration, sessionRef, turnsRef, setConversationId, setTurns } = args
  useEffect(() => {
    if (!bridgeReady || indexGeneration === null) {
      return
    }
    const session = sessionRef.current
    let active = true
    void (async () => {
      try {
        const [latest] = await listChatConversations(1)
        if (latest === undefined || Date.now() - latest.updatedMs > CHAT_IDLE_CUTOFF_MS) {
          return
        }
        const restored = await loadChatMessages(latest.id)
        if (!active || session !== sessionRef.current || turnsRef.current.length > 0) {
          return
        }
        setConversationId(latest.id)
        setTurns(restored)
      } catch (cause) {
        console.error('chat: restoring the last conversation failed:', errorMessage(cause))
      }
    })()
    return () => {
      active = false
    }
  }, [bridgeReady, indexGeneration])
}
