import { isMainWindow } from '@/lib/windows/window-role'
import { tagSchemaAiPrompt } from '@/lib/tags/schema-ai-prompt'
import { useOptionalChatSession } from '@/providers/chat-provider'
import { useRouter } from '@/routing/router'

/**
 * "Suggest with AI" for a tag's properties: closes the config surface and
 * opens the chat with the request drafted ({@link tagSchemaAiPrompt}).
 * `closeThen` is the surface's discard guard, so unsaved edits are asked
 * about first and the chat opens once they are let go. An idle chat starts a
 * fresh conversation so the proposal is not read against an unrelated
 * transcript; a streaming one is left alone and only gets the draft. Null
 * where the chat is not a place to go (no session, or a secondary note
 * window, which has no way back from it), so the caller hides the row
 * instead of offering a dead end.
 */
export function useSuggestTagSchema(
  tagKey: string,
  closeThen: (then: () => void) => void,
): (() => void) | null {
  const chat = useOptionalChatSession()
  const { navigate } = useRouter()
  if (chat === null || !isMainWindow()) {
    return null
  }
  return () =>
    closeThen(() => {
      if (chat.status === 'idle') {
        chat.newChat()
      }
      chat.setDraft(tagSchemaAiPrompt(tagKey))
      navigate({ kind: 'chat' })
    })
}
