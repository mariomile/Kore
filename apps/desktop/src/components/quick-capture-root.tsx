import {
  useEffect,
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
  windowBootstrap,
} from '@reflect/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  TEXT_CAPTURE_MAX_LENGTH,
  buildGlobalShortcutEnvelope,
  foldQuickCaptureText,
} from '@/lib/quick-capture'
import { installQuitFlush } from '@/lib/quit-flush'

/**
 * The desktop global-shortcut surface: a frameless bar that appends one
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
    <div className="flex h-screen w-screen items-center bg-background px-3">
      <div aria-hidden data-tauri-drag-region className="h-full w-3 shrink-0" />
      <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={onSubmit}>
        <Input
          ref={inputRef}
          value={text}
          maxLength={TEXT_CAPTURE_MAX_LENGTH}
          disabled={pending}
          placeholder="Add to today…"
          aria-label="Capture a line to today's note"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-10"
        />
        <Button type="submit" size="sm" disabled={pending || foldQuickCaptureText(text) === ''}>
          Save
        </Button>
      </form>
      {error !== null ? (
        <p className="ml-2 max-w-[10rem] shrink-0 truncate text-xs text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
