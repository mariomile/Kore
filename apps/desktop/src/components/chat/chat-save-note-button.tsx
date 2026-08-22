import { useState, type ReactElement } from 'react'
import { NotePlus } from '@/components/icons'
import { createNoteWithTitle, errorMessage } from '@reflect/core'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { startOperation } from '@/lib/operations'
import { conversationTitle } from '@/providers/chat-title'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'

interface ChatSaveNoteButtonProps {
  /** The user question the note is titled after. */
  userText: string
  /** The assistant reply markdown that becomes the note body. */
  text: string
}

/**
 * Saves one assistant reply as a regular note and opens it — the
 * user-initiated write: the assistant itself stays read-only. Sits next to
 * the copy button in the reply footer.
 */
export function ChatSaveNoteButton({ userText, text }: ChatSaveNoteButtonProps): ReactElement {
  const { graph } = useGraph()
  const { navigate } = useRouter()
  const [saving, setSaving] = useState(false)

  const saveReply = async (): Promise<void> => {
    if (graph === null || saving) {
      return
    }
    setSaving(true)
    try {
      const path = await createNoteWithTitle(conversationTitle(userText), graph.generation, text)
      navigate({ kind: 'note', path })
    } catch (cause) {
      startOperation('Saving the reply as a note').fail(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Save reply as note"
            disabled={saving}
            onClick={() => void saveReply()}
            className="size-5 rounded-md text-text-muted hover:text-text"
          >
            <NotePlus aria-hidden className="size-3" />
          </Button>
        }
      />
      <TooltipContent>Save reply as note</TooltipContent>
    </Tooltip>
  )
}
