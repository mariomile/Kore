import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import {
  captureInboxSpool,
  errorMessage,
  hideQuickCapture,
  parseQuickAdd,
  QUICK_ADD_MAX_ADDED,
  windowBootstrap,
} from '@kore/core'
import { QuickAddChips } from '@/components/tasks/task-quick-add'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/kbd'
import { ArrowRight, CheckCircle, NotePlus } from '@/components/icons'
import { todayIso } from '@/lib/dates'
import { cn } from '@/lib/utils'
import {
  TEXT_CAPTURE_MAX_LENGTH,
  buildGlobalShortcutEnvelope,
  foldQuickCaptureText,
} from '@/lib/quick-capture'
import { installQuitFlush } from '@/lib/quit-flush'

/**
 * The desktop global-shortcut surface: a focused Quick Entry window that appends one
 * line to today's daily note via the capture inbox. It never boots the
 * graph workspace — the main window owns indexing, sync, and the drain.
 */
export function QuickCaptureRoot(): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Task mode (⌘T): the line is read as a Quick Add task — "call Anna
  // tomorrow at 3pm p1" lands as `+ [ ] !! call Anna [[…]] @15:00`. This
  // window has no project list, so `#Name` stays text and the task always
  // lands in today's note; projects are picked from Quick Add in Tasks (`q`).
  const [asTask, setAsTask] = useState(false)
  const parsed = useMemo(() => (asTask ? parseQuickAdd(text, todayIso()) : null), [asTask, text])

  useEffect(() => installQuitFlush(), [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function submitCapture(): Promise<void> {
    const line = parsed !== null ? parsed.content : foldQuickCaptureText(text)
    if (line === '') {
      return
    }
    setPending(true)
    setError(null)
    try {
      const boot = await windowBootstrap()
      const envelope = buildGlobalShortcutEnvelope(line, asTask ? 'task' : 'append')
      await captureInboxSpool(
        `${envelope.id}.json`,
        JSON.stringify(envelope),
        boot.graph.generation,
      )
      setText('')
      await hideQuickCapture()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void submitCapture()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      void hideQuickCapture()
    } else if ((event.metaKey || event.ctrlKey) && (event.key === 't' || event.key === 'T')) {
      event.preventDefault()
      setAsTask((current) => !current)
    }
  }

  return (
    <div className="h-screen w-screen bg-transparent p-2">
      <section className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface">
        <header
          data-tauri-drag-region
          className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-3.5"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-text">
            <NotePlus className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-medium text-text">Quick Entry</h1>
            <p className="text-xs text-text-muted">
              {asTask ? 'Task, saved to today’s note' : 'Saved to today’s note'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <Kbd>esc</Kbd>
            <span>Close</span>
          </div>
        </header>

        <form className="flex min-h-0 flex-1 flex-col px-3.5 py-3" onSubmit={onSubmit}>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Input
              ref={inputRef}
              value={text}
              // A task line grows by its date, time and repeat; keep it under
              // the capture envelope's limit.
              maxLength={
                asTask ? TEXT_CAPTURE_MAX_LENGTH - QUICK_ADD_MAX_ADDED : TEXT_CAPTURE_MAX_LENGTH
              }
              disabled={pending}
              placeholder={
                asTask ? 'Call Anna tomorrow at 3pm p1' : 'What do you want to remember?'
              }
              aria-label={asTask ? 'Capture a task' : "Capture a line to today's note"}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              className="h-9 flex-1 border-0 bg-transparent px-0 text-base shadow-none focus-visible:border-transparent md:text-base dark:bg-transparent"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={asTask}
              title="Save as a task, reading dates, times and priority (⌘T)"
              onClick={() => {
                setAsTask((current) => !current)
                inputRef.current?.focus()
              }}
              className={cn('gap-1.5', asTask ? 'text-accent' : 'text-text-muted')}
            >
              <CheckCircle aria-hidden className="size-3.5" />
              Task
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                pending || (parsed !== null ? parsed.content : foldQuickCaptureText(text)) === ''
              }
              className="gap-1.5"
            >
              {pending ? 'Adding…' : 'Add'}
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
          {parsed !== null ? <QuickAddChips parsed={parsed} className="mt-1.5" /> : null}
          <div className="mt-1 flex min-h-4 items-center text-xs text-text-muted">
            {error !== null ? (
              <p className="truncate text-destructive" role="alert">
                {error}
              </p>
            ) : (
              <p>
                Press <Kbd className="mx-1">↩</Kbd> to add
              </p>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}
