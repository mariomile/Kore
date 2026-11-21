import { useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { parseRating } from '@kore/core'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  EditorTrigger,
  editorSeedList,
  editorSeedText,
  typedValueForText,
  type PropertyEditorProps,
} from './property-editor-shared'

/**
 * An input-backed editor (text, url, date, number). Renders in a popover on
 * panel/card surfaces, or edits directly inside the cell when `variant` is
 * `'table-cell'` (Notion's inline table editing, with Tab cell stepping).
 */
export function InputPropertyEditor({
  property,
  value,
  onCommit,
  children,
  align,
  variant = 'default',
  onStepCell,
}: PropertyEditorProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const validationId = useId()
  // Esc closes the editor, which also blurs the input — the
  // flag keeps that path a cancel instead of a phantom commit.
  const cancelled = useRef(false)
  // What the input opened with. An untouched draft never commits: a value
  // the column's type can't represent (a string under a number column, a
  // list under a scalar one — the mismatch cases) must survive open + blur
  // untouched. Tolerated, never destroyed (TDR 0005).
  const seed = useRef('')

  const inputRef = useRef<HTMLInputElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const openEditor = (): void => {
    cancelled.current = false
    setValidationError(null)
    seed.current =
      property.type === 'files' ? editorSeedList(value).join(', ') : editorSeedText(value)
    setDraft(seed.current)
    setOpen(true)
  }

  const commit = (): boolean => {
    if (cancelled.current) {
      return true
    }
    if (draft === seed.current) {
      cancelled.current = true
      setOpen(false)
      return true
    }
    const trimmed = draft.trim()
    if (
      property.type === 'rating' &&
      (inputRef.current?.validity.badInput === true ||
        (trimmed !== '' && parseRating(Number(trimmed)) === null))
    ) {
      setValidationError('Enter a whole number from 1 to 5.')
      inputRef.current?.focus()
      return false
    }
    // Unparseable numeric input is a typo, not a delete — keep the stored
    // value rather than erasing it. `badInput` catches the number-input case
    // where the DOM reports '' for half-typed input like `4e`, which would
    // otherwise read as an intentional clear.
    if (
      (property.type === 'number' || property.type === 'rating') &&
      ((trimmed !== '' && !Number.isFinite(Number(trimmed))) ||
        inputRef.current?.validity.badInput === true)
    ) {
      cancelled.current = true
      setOpen(false)
      return true
    }
    cancelled.current = true // a blur following an Enter-commit is a no-op
    onCommit(typedValueForText(property, draft))
    setOpen(false)
    return true
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      cancelled.current = true
      setValidationError(null)
      if (variant === 'table-cell') {
        event.preventDefault()
        setOpen(false)
        requestAnimationFrame(() => triggerRef.current?.focus())
      }
    } else if (event.key === 'Tab' && variant === 'table-cell' && onStepCell !== undefined) {
      event.preventDefault()
      if (commit()) {
        onStepCell(event.shiftKey ? 'prev' : 'next')
      }
    }
  }
  const inputType =
    property.type === 'number' || property.type === 'rating'
      ? 'number'
      : property.type === 'date'
        ? 'date'
        : property.type === 'email'
          ? 'email'
          : property.type === 'phone'
            ? 'tel'
            : 'text'

  if (variant === 'table-cell') {
    if (!open) {
      return (
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Edit ${property.name}`}
          onClick={(event) => {
            event.stopPropagation()
            openEditor()
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className="flex h-full w-full min-w-0 items-center self-stretch px-2.5 text-left transition-colors hover:bg-surface-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          {children}
        </button>
      )
    }
    const alignRight = property.type === 'number' || property.type === 'rating'
    return (
      <div
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        className="relative z-10 flex h-full w-full min-w-0 items-center bg-surface ring-2 ring-inset ring-accent"
      >
        <input
          ref={inputRef}
          autoFocus
          type={inputType}
          min={property.type === 'rating' ? 1 : undefined}
          max={property.type === 'rating' ? 5 : undefined}
          step={property.type === 'rating' ? 1 : undefined}
          value={draft}
          aria-label={property.name}
          aria-invalid={validationError !== null}
          aria-describedby={validationError === null ? undefined : validationId}
          placeholder={property.name}
          onChange={(event) => {
            setValidationError(null)
            setDraft(event.target.value)
          }}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          className={cn(
            'h-full w-full min-w-0 bg-transparent px-2.5 text-[13px] text-text outline-none placeholder:text-text-muted',
            alignRight && 'text-right tabular-nums',
          )}
        />
        {validationError === null ? null : (
          <p
            id={validationId}
            role="alert"
            className="absolute top-full left-0 z-30 mt-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-destructive shadow-md"
          >
            {validationError}
          </p>
        )}
      </div>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next, eventDetails) => {
        if (!next && eventDetails.reason === 'escape-key') {
          cancelled.current = true
          setValidationError(null)
        }
        if (!next && !cancelled.current && !commit()) {
          eventDetails.cancel()
          return
        }
        setOpen(next)
        if (next) {
          cancelled.current = false
          setValidationError(null)
          seed.current =
            property.type === 'files' ? editorSeedList(value).join(', ') : editorSeedText(value)
          setDraft(seed.current)
        }
      }}
    >
      <EditorTrigger name={property.name}>{children}</EditorTrigger>
      <PopoverContent align={align ?? 'start'} sideOffset={4} className="w-56 p-2">
        <Input
          ref={inputRef}
          autoFocus
          type={inputType}
          min={property.type === 'rating' ? 1 : undefined}
          max={property.type === 'rating' ? 5 : undefined}
          step={property.type === 'rating' ? 1 : undefined}
          value={draft}
          aria-label={property.name}
          aria-invalid={validationError !== null}
          aria-describedby={validationError === null ? undefined : validationId}
          placeholder={property.name}
          onChange={(event) => {
            setValidationError(null)
            setDraft(event.target.value)
          }}
          onKeyDown={handleKeyDown}
          onBlur={commit}
        />
        {validationError === null ? null : (
          <p id={validationId} role="alert" className="px-1 text-xs text-destructive">
            {validationError}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
