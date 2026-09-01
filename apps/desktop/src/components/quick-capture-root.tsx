import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { captureInboxSpool, errorMessage, hideQuickCapture, windowBootstrap } from '@reflect/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/kbd'
import { ArrowRight, NotePlus } from '@/components/icons'
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

  useEffect(() => installQuitFlush(), [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function submitCapture(): Promise<void> {
    const line = foldQuickCaptureText(text)
    if (line === '') {
      return
    }
    setPending(true)
    setError(null)
    try {
      const boot = await windowBootstrap()
      const envelope = buildGlobalShortcutEnvelope(line)
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
            <p className="text-xs text-text-muted">Saved to today&apos;s note</p>
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
              maxLength={TEXT_CAPTURE_MAX_LENGTH}
              disabled={pending}
              placeholder="What do you want to remember?"
              aria-label="Capture a line to today's note"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              className="h-9 flex-1 border-0 bg-transparent px-0 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-base dark:bg-transparent"
            />
            <Button
              type="submit"
              size="sm"
              disabled={pending || foldQuickCaptureText(text) === ''}
              className="gap-1.5"
            >
              {pending ? 'Adding…' : 'Add'}
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
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
