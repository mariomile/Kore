import { tagSchemaAiPrompt } from '@/lib/tags/schema-ai-prompt'
import { useOptionalChatSession } from '@/providers/chat-provider'
import { useRouter } from '@/routing/router'

/**
 * "Suggest with AI" for a tag's properties: closes the config surface and
 * opens the chat with the request drafted ({@link tagSchemaAiPrompt}). With
 * unsaved edits `requestClose` asks about them first and nothing else
 * happens, so leaving for the chat never drops an edit silently. An
 * idle chat starts a fresh conversation so the proposal is not read against
 * an unrelated transcript; a streaming one is left alone and only gets the
 * draft. Null where no chat session is mounted (secondary windows), so the
 * caller hides the row instead of offering a dead end.
 */
export function useSuggestTagSchema(
  tagKey: string,
  dirty: boolean,
  requestClose: () => void,
): (() => void) | null {
  const chat = useOptionalChatSession()
  const { navigate } = useRouter()
  if (chat === null) {
    return null
  }
  return () => {
    requestClose()
    if (dirty) {
      return
    }
    if (chat.status === 'idle') {
      chat.newChat()
    }
    chat.setDraft(tagSchemaAiPrompt(tagKey))
    navigate({ kind: 'chat' })
  }
}
