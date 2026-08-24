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
import { logCompanyCapture } from '@/lib/company-capture'
import { readGraphRole } from '@/lib/graph-role'
import {
  TEXT_CAPTURE_MAX_LENGTH,
  buildGlobalShortcutEnvelope,
  defaultQuickCaptureDestination,
  foldQuickCaptureText,
  type QuickCaptureDestination,
} from '@/lib/quick-capture'
import { installQuitFlush } from '@/lib/quit-flush'
import { cn } from '@/lib/utils'

const DESTINATIONS: readonly { readonly id: QuickCaptureDestination; readonly label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'decision', label: 'Decision' },
  { id: 'meeting', label: 'Meeting' },
]

function destinationLabel(destination: QuickCaptureDestination): string {
  if (destination === 'today') {
    return "Capture a line to today's note"
  }
  if (destination === 'decision') {
    return 'Log a decision'
  }
  return 'Log a meeting'
}

function destinationPlaceholder(destination: QuickCaptureDestination): string {
  if (destination === 'today') {
    return 'Add to today…'
  }
  if (destination === 'decision') {
    return 'Log a decision…'
  }
  return 'Log a meeting…'
}

/**
 * The desktop global-shortcut surface: a frameless bar that appends one
 * line to today's daily note via the capture inbox, or writes a named
 * company note. It never boots the graph workspace — the main window owns
 * indexing, sync, and the drain.
 */
export function QuickCaptureRoot(): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [destination, setDestination] = useState<QuickCaptureDestination>('today')
  const [isCompany, setIsCompany] = useState(false)

  useEffect(() => installQuitFlush(), [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    void windowBootstrap()
      .then((boot) => readGraphRole(boot.graph.generation))
      .then((role) => {
        if (!cancelled) {
          setIsCompany(role === 'company')
          setDestination(defaultQuickCaptureDestination(role))
        }
      })
      .catch(() => {
        // Stay on today — the inbox path still works.
      })
    return () => {
      cancelled = true
    }
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
      if (destination === 'today' || !isCompany) {
        const envelope = buildGlobalShortcutEnvelope(line)
        await captureInboxSpool(
          `${envelope.id}.json`,
          JSON.stringify(envelope),
          boot.graph.generation,
        )
      } else {
        await logCompanyCapture(destination, boot.graph.generation, line)
      }
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
    <div className="flex h-screen w-screen flex-col justify-center bg-background px-3 py-2">
      {isCompany ? (
        <div
          role="radiogroup"
          aria-label="Capture destination"
          className="mb-1.5 flex items-center gap-1 pl-3"
        >
          {DESTINATIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={destination === entry.id}
              disabled={pending}
              onClick={() => setDestination(entry.id)}
              className={cn(
                'rounded-md px-2 py-0.5 text-2xs font-medium transition-colors',
                destination === entry.id
                  ? 'bg-accent-soft text-accent-soft-text'
                  : 'text-text-muted hover:text-text',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center">
        <div aria-hidden data-tauri-drag-region className="h-10 w-3 shrink-0" />
        <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={onSubmit}>
          <Input
            ref={inputRef}
            value={text}
            maxLength={TEXT_CAPTURE_MAX_LENGTH}
            disabled={pending}
            placeholder={destinationPlaceholder(destination)}
            aria-label={destinationLabel(destination)}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-10"
          />
          <Button type="submit" size="sm" disabled={pending || foldQuickCaptureText(text) === ''}>
            Save
          </Button>
        </form>
        {error !== null ? (
          <p
            className="ml-2 max-w-[10rem] shrink-0 truncate text-xs text-red-700 dark:text-red-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
