import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent } from '@/components/ui/popover'
import {
  EditorTrigger,
  editorSeedList,
  editorSeedText,
  typedValueForText,
  type PropertyEditorProps,
} from './property-editor-shared'

/** An input-backed editor (text, url, date, number) inside a popover. */
export function InputPropertyEditor({
  property,
  value,
  onCommit,
  children,
  align,
}: PropertyEditorProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  // Esc closes the popover through Radix, which also blurs the input — the
  // flag keeps that path a cancel instead of a phantom commit.
  const cancelled = useRef(false)
  // What the input opened with. An untouched draft never commits: a value
  // the column's type can't represent (a string under a number column, a
  // list under a scalar one — the mismatch cases) must survive open + blur
  // untouched. Tolerated, never destroyed (TDR 0005).
  const seed = useRef('')

  const inputRef = useRef<HTMLInputElement | null>(null)

  const commit = (): void => {
    if (cancelled.current || draft === seed.current) {
      return
    }
    cancelled.current = true // a blur following an Enter-commit is a no-op
    const trimmed = draft.trim()
    // Unparseable numeric input is a typo, not a delete — keep the stored
    // value rather than erasing it. `badInput` catches the number-input case
    // where the DOM reports '' for half-typed input like `4e`, which would
    // otherwise read as an intentional clear.
    if (
      (property.type === 'number' || property.type === 'rating') &&
      ((trimmed !== '' && !Number.isFinite(Number(trimmed))) ||
        inputRef.current?.validity.badInput === true)
    ) {
      setOpen(false)
      return
    }
    onCommit(typedValueForText(property, draft))
    setOpen(false)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      cancelled.current = true
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

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          cancelled.current = false
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
          placeholder={property.name}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
        />
      </PopoverContent>
    </Popover>
  )
}
