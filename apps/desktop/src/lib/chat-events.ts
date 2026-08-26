export type ChatConversationDeletedListener = (conversationId: string) => void

const deletedListeners = new Set<ChatConversationDeletedListener>()

/** Subscribe to successful conversation deletions; returns the unsubscribe. */
export function onChatConversationDeleted(listener: ChatConversationDeletedListener): () => void {
  deletedListeners.add(listener)
  return () => {
    deletedListeners.delete(listener)
  }
}

/** Notify workspace state that a conversation can no longer be opened. */
export function emitChatConversationDeleted(conversationId: string): void {
  for (const listener of deletedListeners) {
    try {
      listener(conversationId)
    } catch (cause) {
      console.error('chat-deleted listener failed:', cause)
    }
  }
}
