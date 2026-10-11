import { useRef, useState, type ReactElement, type ReactNode } from 'react'
import { baseCellEditText, parseBaseCellInput, type BaseCellEdit } from '@reflect/core'

interface BaseCellEditorProps {
  edit: BaseCellEdit
  label: string
  /** What the cell shows while not editing. */
  children: ReactNode
  /** Write the parsed value; `undefined` clears the key. */
  onCommit: (value: unknown) => void
}

/**
 * One editable base cell. A checkbox toggles in place; anything else shows
 * its value until clicked, then a text box that saves on Enter or blur and
 * gives up on Escape. Typed values keep their type (see `parseBaseCellInput`).
 */
export function BaseCellEditor({
  edit,
  label,
  children,
  onCommit,
}: BaseCellEditorProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  // A saved value shows until the index refresh brings the real one back:
  // it only holds while the cell still shows the value it replaced.
  const [saved, setSaved] = useState<{ text: string; over: string } | null>(null)
  // Escape closes the box; the blur that follows must not save it.
  const cancelled = useRef(false)
  const current = baseCellEditText(edit)
  const pending = saved !== null && saved.over === current ? saved.text : null
  const setPending = (text: string): void => {
    setSaved({ text, over: current })
  }

  if (edit.kind === 'boolean') {
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={pending === null ? edit.value : pending === 'true'}
        onChange={(event) => {
          setPending(String(event.target.checked))
          onCommit(event.target.checked)
        }}
        className="size-3.5 accent-accent"
      />
    )
  }

  if (draft === null) {
    return (
      <button
        type="button"
        aria-label={`Edit ${label}`}
        onClick={() => {
          cancelled.current = false
          setDraft(pending ?? current)
        }}
        className="block min-h-5 w-full min-w-12 truncate rounded-sm text-left hover:bg-surface-hover"
      >
        {pending === null ? children : <span className="text-text-secondary">{pending}</span>}
      </button>
    )
  }

  const save = (): void => {
    if (cancelled.current) {
      return
    }
    cancelled.current = true
    const next = draft.trim()
    setDraft(null)
    if (next === current) {
      return
    }
    setPending(next)
    onCommit(parseBaseCellInput(edit, next))
  }
  return (
    <input
      autoFocus
      aria-label={label}
      value={draft}
      inputMode={edit.kind === 'number' ? 'decimal' : undefined}
      placeholder={edit.kind === 'list' ? 'a, b, c' : undefined}
      onChange={(event) => {
        setDraft(event.target.value)
      }}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          save()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancelled.current = true
          setDraft(null)
        }
      }}
      className="w-full min-w-24 rounded-sm bg-surface px-1 text-[13px] text-text outline-none ring-1 ring-border focus:ring-accent"
    />
  )
}
