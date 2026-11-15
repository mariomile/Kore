import { useRef, useState, type ReactElement, type RefObject } from 'react'
import { aiModelLabel, CHAT_ATTACHMENT_ACCEPT } from '@kore/core'
import { ArrowUp, ChevronDown, Close, Notebook, Plus, Stop } from '@/components/icons'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentGroup,
} from '@/components/ui/attachment'
import { Button } from '@/components/ui/button'
import { ChatAttachmentThumb } from '@/components/chat/chat-attachment-thumb'
import { useComposerHeightVar } from '@/components/chat/use-composer-height'
import { ChatModelDrawer } from '@/mobile/chat-model-drawer'
import { useArrivalFocus } from '@/mobile/use-arrival-focus'
import { useChatSession } from '@/providers/chat-provider'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'

/**
 * Grows a 36pt control's touch target to 44pt without growing what it draws:
 * an invisible ring of 4pt past each edge (Apple's minimum hit size).
 */
const HIT_AREA = "relative after:absolute after:-inset-1 after:content-['']"

/**
 * The mobile chat composer (Plan 23): a plain textarea bound to the
 * session's draft — provider state, so a half-typed message survives tab
 * switches — with a photo/file attach button, the model trigger (a bottom
 * sheet, not desktop's dropdown), and send/stop. Enter inserts a newline;
 * sending is the button, the mobile convention. The textarea never registers
 * with the formatting-toolbar store, so the shell's keyboard slot stays
 * empty and the composer lands on the keyboard's top edge (contract 6).
 *
 * The composer is a floating translucent card over the turn list's bottom
 * edge (the `bg-popover` blur recipe), not a full-width strip: the
 * conversation scrolls under it, and the list pads past its published
 * height ({@link useComposerHeightVar}). Craft's register: a generously
 * rounded card that opens on the context chip (what a question runs over)
 * while the conversation is empty, with outlined capsules for attach and
 * model along the bottom.
 */
interface MobileChatComposerProps {
  /**
   * The textarea, for a caller that fills the draft and focuses it (a saved
   * prompt picked from the empty transcript).
   */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}

export function MobileChatComposer({
  textareaRef: externalTextareaRef,
}: MobileChatComposerProps): ReactElement {
  const { arrivalSeq, arrivalFocusEditor } = useRouter()
  const { graph } = useGraph()
  const {
    turns,
    status,
    activeModel,
    draft,
    setDraft,
    attachments,
    attachFiles,
    removeAttachment,
    send,
    canSteer,
    stop,
  } = useChatSession()
  const [modelOpen, setModelOpen] = useState(false)
  const composerRef = useComposerHeightVar()
  const localTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const textareaRef = externalTextareaRef ?? localTextareaRef
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const streaming = status === 'streaming'
  const empty = draft.trim() === '' && attachments.length === 0
  // While a reply streams, a typed message can steer it (text only — see
  // the session's `send`); the button beside Stop says so.
  const steering = streaming && canSteer && draft.trim() !== '' && attachments.length === 0

  useArrivalFocus({ arrivalSeq, arrivalFocusEditor, target: textareaRef })

  const submit = (): void => {
    if ((streaming && !steering) || empty) {
      return
    }
    void send(draft)
  }

  return (
    // The card floats above the glass tab bar (its published height is the
    // offset); with the keyboard up the tab bar unmounts, its variable
    // clears, and the card lands on the keyboard's top edge.
    <div
      ref={composerRef}
      className="absolute inset-x-0 z-10 px-3 pb-2"
      style={{ bottom: 'var(--mobile-tab-bar-height, 0px)' }}
    >
      <div className="rounded-[1.625rem] border border-border bg-popover shadow-md transition-colors duration-150 ease-swift focus-within:border-border-focus">
        {turns.length === 0 && !steering && graph !== null ? (
          // What the question runs over, before the first one is asked (once
          // a conversation runs, each reply lists its own "Context used").
          // A label, not a control: there is one scope today, the vault.
          <div className="px-2.5 pt-2.5">
            <div
              className="inline-flex max-w-full items-center gap-2.5 rounded-2xl bg-surface-hover py-1.5 pr-3.5 pl-1.5"
              aria-label={`Context: all notes in ${graph.name}`}
              role="note"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[0.625rem] border border-border bg-surface text-text">
                <Notebook aria-hidden className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col leading-tight" aria-hidden>
                <span className="truncate text-sm font-semibold text-text">All notes</span>
                <span className="truncate text-xs text-text-muted">{graph.name}</span>
              </span>
            </div>
          </div>
        ) : null}
        {steering ? (
          <p className="px-3.5 pt-2.5 text-xs text-text-muted">
            Steering — sent to the current reply
          </p>
        ) : null}
        {attachments.length > 0 ? (
          <AttachmentGroup className="flex-wrap gap-2 overflow-visible px-3 pt-3">
            {attachments.map((attachment) => (
              <Attachment
                key={attachment.id}
                orientation="vertical"
                size="sm"
                className="w-16 bg-surface"
              >
                <ChatAttachmentThumb attachment={attachment} />
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
          className="field-sizing-content max-h-40 w-full resize-none bg-transparent px-4 pt-3 pb-1.5 text-base text-text outline-none placeholder:text-text-muted"
        />
        <div className="flex items-center gap-2 px-2.5 pb-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept={CHAT_ATTACHMENT_ACCEPT}
            multiple
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              if (files.length > 0) {
                void attachFiles(files)
              }
              // Reset so picking the same photo twice fires change again.
              event.target.value = ''
            }}
          />
          <Button
            variant="ghost"
            size="icon-lg"
            className={`rounded-full border border-border text-text-secondary ${HIT_AREA}`}
            aria-label="Attach a photo or file"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus aria-hidden />
          </Button>
          <button
            type="button"
            aria-label="Model"
            className={`flex h-9 min-w-0 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm text-text-secondary active:bg-surface-hover ${HIT_AREA}`}
            onClick={() => setModelOpen(true)}
          >
            <span className="min-w-0 truncate">
              {activeModel !== null
                ? aiModelLabel(activeModel.provider, activeModel.model)
                : 'Choose a model'}
            </span>
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-text-muted" />
          </button>
          <div className="flex-1" />
          {streaming ? (
            <>
              {steering ? (
                <Button
                  size="icon-lg"
                  className={`rounded-full ${HIT_AREA}`}
                  aria-label="Steer"
                  onClick={submit}
                >
                  <ArrowUp aria-hidden />
                </Button>
              ) : null}
              <Button
                size="icon-lg"
                variant={steering ? 'ghost' : 'default'}
                className={`rounded-full ${HIT_AREA}`}
                aria-label="Stop"
                onClick={stop}
              >
                <Stop aria-hidden className="size-3 fill-current" />
              </Button>
            </>
          ) : (
            <Button
              size="icon-lg"
              className={`rounded-full ${HIT_AREA}`}
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
