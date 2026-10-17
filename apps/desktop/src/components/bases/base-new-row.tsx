import { useState, type KeyboardEvent, type ReactElement } from 'react'
import { Plus } from '@/components/icons'
import { cn } from '@/lib/utils'

interface BaseNewRowProps {
  /** Creates the note and resolves whether it was written; the line stays busy until then. */
  onCreate: (title: string) => Promise<boolean>
  /** Names the place the note lands in, for the accessible label (a lane). */
  label?: string | undefined
  className?: string
}

/**
 * The "+ New" line at the end of a base view, section or board lane. The title is
 * typed in place and the note is born on Enter, never on focus, so an
 * abandoned line leaves no file behind. Escape, or leaving it empty, cancels;
 * a failed create keeps the typed title.
 */
export function BaseNewRow({ onCreate, label, className }: BaseNewRowProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const name = label === undefined ? 'New note' : `New note in ${label}`

  const commit = async (): Promise<void> => {
    const title = (draft ?? '').trim()
    if (title === '' || creating) {
      setDraft(null)
      return
    }
    setCreating(true)
    try {
      if (await onCreate(title)) {
        setDraft(null)
      }
    } finally {
      setCreating(false)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(null)
    }
  }

  if (draft === null) {
    return (
      <button
        type="button"
        aria-label={name}
        onClick={() => setDraft('')}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md py-1.5 text-[13px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary',
          className,
        )}
      >
        <Plus aria-hidden className="size-3" />
        New
      </button>
    )
  }
  return (
    <div className={cn('flex items-center py-1.5', className)}>
      <input
        autoFocus
        aria-label={`${name}, title`}
        placeholder="Title, then Enter"
        value={draft}
        disabled={creating}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void commit()}
        className="w-full bg-transparent text-[13px] font-medium text-text outline-none placeholder:text-text-muted"
      />
    </div>
  )
}
