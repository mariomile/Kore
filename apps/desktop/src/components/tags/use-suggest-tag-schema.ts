import { useCallback } from 'react'
import { tagSchemaAiPrompt } from '@/lib/tags/schema-ai-prompt'
import { useOptionalChatSession } from '@/providers/chat-provider'
import { useRouter } from '@/routing/router'

/**
 * "Suggest with AI" for a tag's properties: closes the config surface and
 * opens the chat with the request drafted ({@link tagSchemaAiPrompt}). An
 * idle chat starts a fresh conversation so the proposal is not read against
 * an unrelated transcript; a streaming one is left alone and only gets the
 * draft. Null where no chat session is mounted (secondary windows), so the
 * caller hides the row instead of offering a dead end.
 */
export function useSuggestTagSchema(tagKey: string, onClose: () => void): (() => void) | null {
  const chat = useOptionalChatSession()
  const { navigate } = useRouter()
  const newChat = chat?.newChat
  const setDraft = chat?.setDraft
  const idle = chat?.status === 'idle'

  const suggest = useCallback((): void => {
    if (newChat === undefined || setDraft === undefined) {
      return
    }
    onClose()
    if (idle) {
      newChat()
    }
    setDraft(tagSchemaAiPrompt(tagKey))
    navigate({ kind: 'chat' })
  }, [idle, navigate, newChat, onClose, setDraft, tagKey])

  return chat === null ? null : suggest
}
