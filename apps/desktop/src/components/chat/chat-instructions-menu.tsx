import { useEffect, useRef, useState, type ReactElement } from 'react'
import { CHAT_SYSTEM_PROMPT_MAX_LENGTH, normalizeChatSystemPrompt } from '@reflect/core'
import { Sliders } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useChatSession } from '@/providers/chat-provider'
import { useSettings } from '@/providers/settings-provider'

/**
 * Both layers of chat instructions, one popover, beside the chat itself.
 *
 * The always-on system prompt used to be reachable only through Settings → AI
 * chat, which is a long way to go for the thing people re-tune most; it now
 * lives here too, editing the same `chatSystemPrompt` setting, so Settings and
 * this popover are two views of one value. Below it, the per-conversation
 * instructions layer on top and reset with New chat — the distinction the
 * popover states rather than leaving the user to infer.
 */
export function ChatInstructionsMenu(): ReactElement {
  const { instructions, setInstructions } = useChatSession()
  const { settings, updateSettings } = useSettings()

  // The persisted prompt is edited as a draft and written on close: writing on
  // every keystroke would round-trip the whole settings document per character.
  const [draft, setDraft] = useState(settings.chatSystemPrompt)
  const [dirty, setDirty] = useState(false)
  const draftRef = useRef(draft)
  const dirtyRef = useRef(dirty)
  const updateSettingsRef = useRef(updateSettings)
  const shown = dirty ? draft : settings.chatSystemPrompt

  useEffect(() => {
    updateSettingsRef.current = updateSettings
  }, [updateSettings])

  const savePrompt = (): void => {
    if (!dirtyRef.current) {
      return
    }
    const normalized = normalizeChatSystemPrompt(draftRef.current)
    draftRef.current = normalized
    dirtyRef.current = false
    setDraft(normalized)
    setDirty(false)
    updateSettingsRef.current({ chatSystemPrompt: normalized })
  }

  // A pending edit must survive the popover — and the screen — going away.
  useEffect(
    () => () => {
      if (dirtyRef.current) {
        dirtyRef.current = false
        updateSettingsRef.current({
          chatSystemPrompt: normalizeChatSystemPrompt(draftRef.current),
        })
      }
    },
    [],
  )

  const active = instructions.trim() !== '' || settings.chatSystemPrompt.trim() !== ''

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) {
          savePrompt()
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Chat instructions"
                  className={active ? 'text-accent' : undefined}
                >
                  <Sliders aria-hidden />
                </Button>
              }
            />
          }
        />
        <TooltipContent side="bottom">Chat instructions</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-3">
        <p className="text-sm font-medium text-text">Always on</p>
        <Textarea
          value={shown}
          onChange={(event) => {
            draftRef.current = event.target.value
            dirtyRef.current = true
            setDraft(event.target.value)
            setDirty(true)
          }}
          onBlur={savePrompt}
          placeholder="e.g. Write like a colleague, not a chatbot…"
          aria-label="Always-on instructions"
          maxLength={CHAT_SYSTEM_PROMPT_MAX_LENGTH}
          rows={3}
          className="mt-2 text-sm"
        />
        <p className="mt-2 text-xs text-text-muted">
          Sent with every chat, in this graph and the next. Same setting as Settings → AI chat.
        </p>
        <p className="mt-4 text-sm font-medium text-text">This conversation</p>
        <Textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="e.g. Answer in Italian, keep it to bullet points…"
          aria-label="Conversation instructions"
          rows={3}
          className="mt-2 text-sm"
        />
        <p className="mt-2 text-xs text-text-muted">
          Layered on top of the always-on instructions, for this conversation only. Cleared by New
          chat.
        </p>
      </PopoverContent>
    </Popover>
  )
}
