import { useRef, useState, type ReactElement } from 'react'
import { aiModelLabel } from '@reflect/core'
import { ArrowUp, ChevronDown, Close, Plus, Stop } from '@/components/icons'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentGroup,
  AttachmentMedia,
} from '@/components/ui/attachment'
import { Button } from '@/components/ui/button'
import { useComposerHeightVar } from '@/components/chat/use-composer-height'
import { ChatModelDrawer } from '@/mobile/chat-model-drawer'
import { useArrivalFocus } from '@/mobile/use-arrival-focus'
import { useChatSession } from '@/providers/chat-provider'
import { useRouter } from '@/routing/router'

/**
 * The mobile chat composer (Plan 23): a plain textarea bound to the
 * session's draft — provider state, so a half-typed message survives tab
 * switches — with a photo-picker attach button, the model trigger (a bottom
 * sheet, not desktop's dropdown), and send/stop. Enter inserts a newline;
 * sending is the button, the mobile convention. The textarea never registers
 * with the formatting-toolbar store, so the shell's keyboard slot stays
 * empty and the composer lands on the keyboard's top edge (contract 6).
 *
 * The composer is a floating translucent card over the turn list's bottom
 * edge (the `bg-popover` blur recipe), not a full-width strip: the
 * conversation scrolls under it, and the list pads past its published
 * height ({@link useComposerHeightVar}).
 */
export function MobileChatComposer(): ReactElement {
  const { arrivalSeq, arrivalFocusEditor } = useRouter()
  const {
    status,
    activeModel,
    draft,
    setDraft,
    attachments,
    attachImages,
    removeAttachment,
    send,
    stop,
  } = useChatSession()
  const [modelOpen, setModelOpen] = useState(false)
  const composerRef = useComposerHeightVar()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const streaming = status === 'streaming'
  const empty = draft.trim() === '' && attachments.length === 0

  useArrivalFocus({ arrivalSeq, arrivalFocusEditor, target: textareaRef })

  const submit = (): void => {
    if (streaming || empty) {
      return
    }
    void send(draft)
  }

  return (
    <div ref={composerRef} className="absolute inset-x-0 bottom-0 z-10 px-3 pb-2">
      <div className="rounded-2xl border border-border bg-popover shadow-md focus-within:border-ring">
        {attachments.length > 0 ? (
          <AttachmentGroup className="flex-wrap gap-2 overflow-visible px-3 pt-3">
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
                    className="size-5 rounded-full border border-border bg-surface p-0 text-text-muted"
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <Close aria-hidden className="size-3" />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </AttachmentGroup>
        ) : null}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about your notes…"
          aria-label="Chat message"
          rows={1}
          data-slot="textarea"
          className="field-sizing-content max-h-40 w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1 text-base text-text outline-none placeholder:text-text-muted"
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              if (files.length > 0) {
                void attachImages(files)
              }
              // Reset so picking the same photo twice fires change again.
              event.target.value = ''
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full bg-surface-hover"
            aria-label="Attach a photo"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus aria-hidden />
          </Button>
          <button
            type="button"
            aria-label="Model"
            className="flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-xs text-text-muted"
            onClick={() => setModelOpen(true)}
          >
            <span className="min-w-0 truncate">
              {activeModel !== null
                ? aiModelLabel(activeModel.provider, activeModel.model)
                : 'Choose a model'}
            </span>
            <ChevronDown aria-hidden className="size-3 shrink-0" />
          </button>
          <div className="flex-1" />
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
      <ChatModelDrawer open={modelOpen} onOpenChange={setModelOpen} />
    </div>
  )
}
