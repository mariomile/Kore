import { useMemo, useRef, useState, type ReactElement } from 'react'
import {
  ArrowUp,
  Bot,
  Close,
  Note,
  NotePlus,
  Pencil,
  Plus,
  Sliders,
  Stop,
} from '@/components/icons'
import { chatToMarkdown, createNoteWithTitle } from '@reflect/core'
import { useGraphRole } from '@/hooks/use-graph-role'
import { logCompanyCapture } from '@/lib/company-capture'
import { getIsComposing, isModEvent } from '@meowdown/core'
import { ShortcutKeys } from '@/components/shortcut-keys'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentGroup,
  AttachmentMedia,
} from '@/components/ui/attachment'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { useNoteMentionAutocomplete } from '@/hooks/use-note-mention-autocomplete'
import { cn } from '@/lib/utils'
import { imageFilesFrom } from '@/lib/chat-attachments'
import { groupModelOptions } from '@/lib/chat-model-groups'
import { keybindingFor } from '@/lib/commands/app-commands'
import { useChatSession } from '@/providers/chat-provider'
import { conversationTitle } from '@/providers/chat-title'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { useRouter } from '@/routing/router'
import { ChatHistoryMenu } from './chat-history-menu'

const NEW_CHAT_BINDING = keybindingFor('chat.new')

/**
 * The composer: a textarea (Enter sends, Shift-Enter breaks, Esc stops a
 * streaming turn), the session's model picker — every configured provider's
 * full model list — and a send button that turns into stop while a turn
 * streams. Pasted images queue as attachments and preview above the
 * textarea — a message can be a photo alone, so Enter sends whenever there
 * is text *or* something attached. The history menu loads past
 * conversations; "New chat" appears once there's a conversation to leave.
 */
export function ChatInput(): ReactElement {
  const {
    turns,
    status,
    providers,
    modelOptions,
    activeModel,
    selectModel,
    draft,
    setDraft,
    attachments,
    attachImages,
    removeAttachment,
    send,
    steer,
    queued,
    removeQueued,
    sendQueuedNow,
    stop,
    newChat,
    instructions,
    setInstructions,
  } = useChatSession()
  const { graph } = useGraph()
  const { role } = useGraphRole()
  const { settings, updateSettings } = useSettings()
  const editsOn = settings.chatAllowEdits
  const { navigate } = useRouter()
  const [savingNote, setSavingNote] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const mention = useNoteMentionAutocomplete(textareaRef, setDraft)
  const streaming = status === 'streaming'
  const empty = draft.trim() === '' && attachments.length === 0

  // Export the transcript as a regular note and open it. The note is a copy —
  // the conversation stays in the chat history untouched.
  const saveAsNote = async () => {
    if (graph === null || savingNote) {
      return
    }
    setSavingNote(true)
    try {
      const title = `Chat — ${conversationTitle(turns[0]?.userText ?? '')}`
      const path = await createNoteWithTitle(title, graph.generation, chatToMarkdown(turns))
      navigate({ kind: 'note', path })
    } catch {
      toast.add({ type: 'error', title: 'Could not save the chat as a note' })
    } finally {
      setSavingNote(false)
    }
  }

  const saveAsDecision = async (): Promise<void> => {
    if (graph === null || savingNote) {
      return
    }
    setSavingNote(true)
    try {
      const title = conversationTitle(turns[0]?.userText ?? '') || 'Decision'
      const path = await logCompanyCapture(
        'decision',
        graph.generation,
        title,
        chatToMarkdown(turns),
      )
      navigate({ kind: 'note', path })
    } catch {
      toast.add({ type: 'error', title: 'Could not save the chat as a decision' })
    } finally {
      setSavingNote(false)
    }
  }

  const groups = useMemo(
    () => groupModelOptions(modelOptions, providers),
    [modelOptions, providers],
  )
  const activeIndex = modelOptions.findIndex(
    (option) =>
      activeModel !== null &&
      option.configId === activeModel.id &&
      option.modelId === activeModel.model,
  )

  // The draft lives in the provider (it must survive the screen unmounting —
  // on mobile every tab switch does that), and a send that goes through
  // clears it there. Sending while a turn streams queues the message — the
  // provider parks it as a card above the composer until the turn settles.
  const submit = () => {
    if (empty) {
      return
    }
    void send(draft)
  }

  return (
    <div className="flex-none px-6 pb-6">
      <div className="mx-auto w-full max-w-2xl rounded-xl border border-border bg-surface focus-within:border-ring">
        {queued.length > 0 ? (
          <div className="flex flex-col gap-1.5 px-3.5 pt-3">
            <p className="text-xs text-text-muted">
              {streaming
                ? 'Queued — sends when the reply finishes'
                : 'Queued — held after Stop; send or discard'}
            </p>
            {queued.map((message) => {
              const images = message.attachments.length
              const imagesLabel = `${images} image${images === 1 ? '' : 's'}`
              const label = message.text !== '' ? conversationTitle(message.text) : imagesLabel
              return (
                <div
                  key={message.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1"
                >
                  <p className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                    {message.text !== '' ? message.text : imagesLabel}
                  </p>
                  {message.text !== '' && images > 0 ? (
                    <span className="flex-none text-xs text-text-muted">+{imagesLabel}</span>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Send queued message: ${label}`}
                    disabled={streaming}
                    onClick={() => void sendQueuedNow(message.id)}
                  >
                    <ArrowUp aria-hidden className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Discard queued message: ${label}`}
                    onClick={() => removeQueued(message.id)}
                  >
                    <Close aria-hidden className="size-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <AttachmentGroup className="flex-wrap gap-2 overflow-visible px-3.5 pt-3 pb-0">
            {attachments.map((attachment) => (
              <Attachment
                key={attachment.id}
                orientation="vertical"
                size="sm"
                className="w-16 bg-surface"
              >
                <AttachmentMedia variant="image" className="w-14">
                  <img src={attachment.dataUrl} alt={attachment.name} />
                </AttachmentMedia>
                <AttachmentActions className="!top-0 !right-0 -translate-y-1/2 translate-x-1/2">
                  <AttachmentAction
                    aria-label={`Remove ${attachment.name}`}
                    className="size-4 rounded-full border border-border bg-surface p-0 text-text-muted hover:text-text"
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <Close aria-hidden className="size-3" />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </AttachmentGroup>
        ) : null}
        {mention.open ? (
          <div className="px-3.5 pt-3">
            <div
              role="listbox"
              aria-label="Mention a note"
              className="w-full rounded-lg border border-border bg-surface-sunken p-1"
            >
              {mention.suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.path}
                  type="button"
                  role="option"
                  aria-selected={index === mention.activeIndex}
                  // Mouse down, not click: the click would blur the textarea
                  // before firing and the popup would close under the cursor.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    mention.pick(suggestion)
                  }}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left',
                    index === mention.activeIndex ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                  )}
                >
                  <Note aria-hidden className="size-3.5 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm text-text">
                    {suggestion.title}
                  </span>
                  <span className="max-w-32 shrink-0 truncate text-xs text-text-muted">
                    {suggestion.path}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            mention.refresh()
          }}
          onClick={() => mention.refresh()}
          onBlur={() => mention.close()}
          onKeyDown={(event) => {
            if (getIsComposing()) {
              return
            }
            // The mention popup gets first claim on arrows, Enter, and Esc.
            if (mention.onKeyDown(event)) {
              return
            }
            // ⌘-Enter steers the live turn (inject engines); it degrades to
            // a plain send/queue when nothing is steerable right now.
            if (event.key === 'Enter' && !event.shiftKey && isModEvent(event)) {
              event.preventDefault()
              if (draft.trim() !== '') {
                void steer(draft)
              }
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
            if (event.key === 'Escape' && streaming) {
              event.preventDefault()
              stop()
            }
          }}
          onPaste={(event) => {
            const files = imageFilesFrom(event.clipboardData)
            if (files.length === 0) {
              return
            }
            event.preventDefault()
            void attachImages(files)
          }}
          placeholder="Ask about your notes…"
          aria-label="Chat message"
          rows={2}
          autoFocus
          /* Opts out of the global :focus-visible outline (styles/index.css);
             the wrapper's focus-within border is the focus treatment here. */
          data-slot="textarea"
          className="field-sizing-content max-h-48 w-full resize-none bg-transparent px-3.5 pt-3 text-sm text-text outline-none placeholder:text-text-muted"
        />
        <div className="flex items-center gap-2 px-2.5 pb-2.5">
          <Select
            value={activeIndex >= 0 ? String(activeIndex) : ''}
            items={modelOptions.map((option, index) => ({
              value: String(index),
              label: option.label,
            }))}
            onValueChange={(value) => {
              const option = modelOptions[Number(value)]
              if (option !== undefined) {
                selectModel({ configId: option.configId, modelId: option.modelId })
              }
            }}
          >
            <SelectTrigger
              aria-label="Model"
              size="sm"
              className="w-auto max-w-64 border-none bg-transparent text-xs text-text-muted shadow-none"
            >
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectGroup key={group.configId}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.options.map(({ option, value }) => (
                    <SelectItem key={value} value={value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          {settings.activeAgentProfile != null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Active agent"
                    className="gap-1 text-xs text-text-secondary"
                    onClick={() => {
                      navigate({ kind: 'agents' })
                    }}
                  >
                    <Bot aria-hidden className="size-3.5" />
                    {settings.activeAgentProfile}
                  </Button>
                }
              />
              <TooltipContent>
                This agent’s soul and memories ride into every message. Click to manage agents.
              </TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Toggle edit mode"
                  aria-pressed={editsOn}
                  onClick={() => {
                    updateSettings({ chatAllowEdits: !editsOn })
                  }}
                  className={editsOn ? 'text-accent' : undefined}
                >
                  <Pencil aria-hidden />
                </Button>
              }
            />
            <TooltipContent>
              {editsOn
                ? 'Edit mode is on — agent chat (Claude Code / Codex) can create and edit notes. Private notes stay locked.'
                : 'Edit mode is off — chat only reads your notes. Turn on to let agent chat (Claude Code / Codex) create and edit notes.'}
            </TooltipContent>
          </Tooltip>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Conversation instructions"
                  className={instructions.trim() !== '' ? 'text-accent' : undefined}
                >
                  <Sliders aria-hidden />
                </Button>
              }
            />
            <PopoverContent align="end" className="w-80 p-3">
              <p className="text-sm font-medium text-text">Conversation instructions</p>
              <Textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="e.g. Answer in Italian, keep it to bullet points…"
                aria-label="Conversation instructions"
                rows={4}
                className="mt-2 text-sm"
              />
              <p className="mt-2 text-xs text-text-muted">
                Applies on top of your global system prompt, for this conversation only. Cleared by
                New chat.
              </p>
            </PopoverContent>
          </Popover>
          <ChatHistoryMenu />
          {turns.length > 0 && !streaming && role === 'company' ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Save as a decision"
                    disabled={savingNote}
                    onClick={() => void saveAsDecision()}
                    className="text-xs"
                  >
                    Save as a decision
                  </Button>
                }
              />
              <TooltipContent side="top">Write a #decision note from this chat</TooltipContent>
            </Tooltip>
          ) : null}
          {turns.length > 0 && !streaming ? (
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
              <TooltipContent side="top">Save chat as note</TooltipContent>
            </Tooltip>
          ) : null}
          {turns.length > 0 && !streaming ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="sm" onClick={newChat}>
                    <Plus aria-hidden data-icon="inline-start" />
                    New chat
                  </Button>
                }
              />
              <TooltipContent side="top">
                New chat {NEW_CHAT_BINDING ? <ShortcutKeys binding={NEW_CHAT_BINDING} /> : null}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {streaming ? (
            <Button size="icon-sm" aria-label="Stop" onClick={stop}>
              <Stop aria-hidden className="size-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              aria-label="Send"
              disabled={empty || activeModel === null}
              onClick={submit}
            >
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
