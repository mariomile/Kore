import { useRef, useState, type FormEvent, type ReactElement } from 'react'
import { captureInboxSpool, errorMessage, textCaptureEnvelopeSchema } from '@reflect/core'
import { Checklist, Note, Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { startOperation } from '@/lib/operations'
import { foldQuickCaptureText, TEXT_CAPTURE_MAX_LENGTH } from '@/lib/quick-capture'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'

/** What a captured line becomes in the daily note. */
type QuickAddKind = 'append' | 'task'

/**
 * Quick add on the mobile daily spine.
 *
 * Voice capture had a first-class affordance here and typing did not: jotting
 * a line meant scrolling the day's editor to its end and landing the caret
 * there, on a surface where the keyboard is already covering half the screen.
 * This is the text half of the same idea — one tap to the field, type, send —
 * sitting beside the record button rather than competing with it.
 *
 * The line goes through the capture inbox, the same durable path the global
 * shortcut, the deep link and the iOS share sheet use, so today's note is
 * created if missing and the line lands under the rules the drain already
 * owns. Nothing here re-implements them.
 */
export function MobileQuickAdd(): ReactElement | null {
  const { graph } = useGraph()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [kind, setKind] = useState<QuickAddKind>('append')
  const [pending, setPending] = useState(false)

  if (graph === null) {
    return null
  }

  const submit = async (): Promise<void> => {
    const line = foldQuickCaptureText(text)
    if (line === '' || pending) {
      return
    }
    setPending(true)
    const operation = startOperation(kind === 'task' ? 'Adding task' : 'Adding to today')
    try {
      const envelope = textCaptureEnvelopeSchema.parse({
        version: 1,
        id: crypto.randomUUID(),
        kind,
        text: line,
        capturedAt: new Date().toISOString(),
        source: 'quick-add',
      })
      await captureInboxSpool(`${envelope.id}.json`, JSON.stringify(envelope), graph.generation)
      setText('')
      operation.done()
      // Stay open and focused: capture comes in bursts, and reopening the
      // field for the second line is the tap this exists to remove.
      inputRef.current?.focus()
    } catch (cause) {
      operation.fail(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void submit()
  }

  if (!open) {
    return (
      <Button
        variant="secondary"
        aria-label="Quick add"
        className="fixed left-4 z-40 h-12 gap-2 rounded-full pr-5 pl-4 shadow-lg"
        style={{ bottom: BOTTOM_OFFSET }}
        onClick={() => {
          setOpen(true)
          // The field mounts this frame; focus once it exists so the keyboard
          // comes up with the tap instead of on a second one.
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
      >
        <Plus aria-hidden className="size-5" />
        <span className="text-sm">Add</span>
      </Button>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      // Collapse when focus leaves the bar entirely with nothing typed — but
      // never when it merely moves to the bar's own task toggle or send
      // button, which is a tap inside the affordance, not away from it.
      onBlur={(event) => {
        if (text.trim() === '' && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false)
        }
      }}
      className="fixed inset-x-3 z-40 flex items-center gap-1.5 rounded-full border border-border bg-popover py-1.5 pr-1.5 pl-2 shadow-lg"
      style={{ bottom: BOTTOM_OFFSET }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Add as a task"
        aria-pressed={kind === 'task'}
        className={cn('shrink-0', kind === 'task' && 'text-accent')}
        onClick={() => setKind((current) => (current === 'task' ? 'append' : 'task'))}
      >
        {kind === 'task' ? <Checklist aria-hidden /> : <Note aria-hidden />}
      </Button>
      <input
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={TEXT_CAPTURE_MAX_LENGTH}
        placeholder={kind === 'task' ? 'New task…' : 'Add to today…'}
        aria-label="Quick add to today"
        enterKeyHint="done"
        className="min-w-0 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-muted"
      />
      <Button
        type="submit"
        size="icon-sm"
        aria-label="Add"
        disabled={pending || foldQuickCaptureText(text) === ''}
        className="shrink-0 rounded-full"
      >
        <Plus aria-hidden />
      </Button>
    </form>
  )
}

/**
 * Above the tab bar, and above the software keyboard once it is up — the same
 * offset the record button uses, so the two stay on one line.
 */
const BOTTOM_OFFSET =
  'calc(max(var(--mobile-tab-bar-height, 0px), calc(var(--keyboard-height, 0px) + 2.75rem)) + 0.75rem)'
