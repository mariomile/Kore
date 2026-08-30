import { useMemo, useRef, useState, type ReactElement } from 'react'
import { ArrowUp, Bot, Close, Note, Pencil, Plug, Stop } from '@/components/icons'
import { cliProviderSupportsMcp, isCliAgentProvider } from '@reflect/core'
import { getIsComposing, isModEvent } from '@meowdown/core'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentGroup,
  AttachmentMedia,
} from '@/components/ui/attachment'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useNoteMentionAutocomplete } from '@/hooks/use-note-mention-autocomplete'
import { cn } from '@/lib/utils'
import { imageFilesFrom } from '@/lib/chat-attachments'
import { groupModelOptions, shortModelLabel } from '@/lib/chat-model-groups'
import { useChatSession } from '@/providers/chat-provider'
import { conversationTitle } from '@/providers/chat-title'
import { useSettings } from '@/providers/settings-provider'
import { useRouter } from '@/routing/router'
import { ChatDraftMentions } from './chat-draft-mentions'
import { useComposerHeightVar } from './use-composer-height'

interface ChatInputProps {
  /**
   * Whether the textarea takes focus on mount. True on the chat route —
   * you navigated there to type. False in the context rail, where the panel
   * is auxiliary: stealing focus would light the composer's focus border and
   * pull the caret out of the note you were editing.
   */
  autoFocus?: boolean
}

/**
 * The composer: a textarea (Enter sends, Shift-Enter breaks, Esc stops a
 * streaming turn), the session's model picker — every configured provider's
 * full model list — and a send button that turns into stop while a turn
 * streams. Pasted images queue as attachments and preview above the
 * textarea — a message can be a photo alone, so Enter sends whenever there
 * is text *or* something attached, and any note the draft has hooked with
 * `[[…]]` shows as a chip ({@link ChatDraftMentions}).
 *
 * Everything about the *conversation* rather than the message — instructions,
 * history, save as note, new chat — lives in {@link ChatHeader} instead.
 */
export function ChatInput({ autoFocus = true }: ChatInputProps = {}): ReactElement {
  const {
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
    chatTools,
    setChatTools,
  } = useChatSession()
  const { settings, updateSettings } = useSettings()
  // Enabling external tools for the conversation goes through an explicit
  // confirmation naming the servers; disabling is immediate.
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false)
  const editsOn = settings.chatAllowEdits
  // The Tools toggle exists only where it could do something: an MCP-capable
  // CLI engine (Claude Code / Codex — Cursor's per-run config denies MCP) and
  // at least one enabled server configured in Settings.
  const enabledMcpServers = settings.mcpServers.filter((server) => server.enabled)
  const toolsAvailable =
    activeModel !== null &&
    isCliAgentProvider(activeModel.provider) &&
    cliProviderSupportsMcp(activeModel.provider) &&
    enabledMcpServers.length > 0
  const { navigate } = useRouter()
  const composerRef = useComposerHeightVar()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const mention = useNoteMentionAutocomplete(textareaRef, setDraft)
  const streaming = status === 'streaming'
  const empty = draft.trim() === '' && attachments.length === 0

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
    // A floating translucent card over the turn list's bottom edge (the
    // `bg-popover` blur recipe): the conversation scrolls under it, and the
    // list pads past the published height (useComposerHeightVar).
    <div ref={composerRef} className="absolute inset-x-0 bottom-0 z-10 px-6 pb-6">
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-border bg-popover shadow-md focus-within:border-ring">
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
                  <img src={attachment.dataUrl ?? ''} alt={attachment.name} />
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
        <ChatDraftMentions draft={draft} />
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
          autoFocus={autoFocus}
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
              label: shortModelLabel(option.label),
            }))}
            onValueChange={(value) => {
              const option = modelOptions[Number(value)]
              if (option !== undefined) {
                selectModel({ configId: option.configId, modelId: option.modelId })
              }
            }}
          >
            {/* A quiet text affordance, not a control: picking a model is a
                secondary action next to writing the message, so the trigger
                carries the model name alone and only shows its chevron and
                surface on hover or focus. */}
            <SelectTrigger
              aria-label="Model"
              size="sm"
              className="h-6 w-auto max-w-44 gap-1 rounded-md border-none bg-transparent px-1.5 text-2xs text-text-muted shadow-none transition-colors duration-100 hover:bg-surface-hover hover:text-text-secondary data-[popup-open]:bg-surface-hover [&_svg]:opacity-0 [&_svg]:transition-opacity [&_svg]:duration-100 hover:[&_svg]:opacity-100 focus-visible:[&_svg]:opacity-100 data-[popup-open]:[&_svg]:opacity-100"
            >
              <SelectValue placeholder="Model" />
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
          {toolsAvailable ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Toggle external tools"
                    aria-pressed={chatTools}
                    onClick={() => {
                      if (chatTools) {
                        setChatTools(false)
                        return
                      }
                      setToolsDialogOpen(true)
                    }}
                    className={chatTools ? 'text-accent' : undefined}
                  >
                    <Plug aria-hidden />
                  </Button>
                }
              />
              <TooltipContent>
                {chatTools
                  ? 'External tools are on for this conversation — agent chat can use your MCP servers. Turns off on New chat.'
                  : 'External tools are off — this conversation is zero-egress. Turn on to let agent chat use your MCP servers.'}
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
          {streaming ? (
            <Button size="icon" className="rounded-full" aria-label="Stop" onClick={stop}>
              <Stop aria-hidden className="size-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="rounded-full"
              aria-label="Send"
              disabled={empty || activeModel === null}
              onClick={submit}
            >
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
      </div>
      <Dialog open={toolsDialogOpen} onOpenChange={setToolsDialogOpen}>
        <DialogContent className="w-[28rem]">
          <DialogHeader>
            <DialogTitle>Turn on external tools?</DialogTitle>
            <DialogDescription>
              For this conversation, agent chat can call your configured MCP{' '}
              {enabledMcpServers.length === 1 ? 'server' : 'servers'} (
              {enabledMcpServers.map((server) => server.name).join(', ')}). What you write and the
              notes the agent reads may be sent to them. Private notes stay locked. Turns off on New
              chat or when you switch conversations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setToolsDialogOpen(false)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setChatTools(true)
                setToolsDialogOpen(false)
              }}
            >
              Turn on
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
