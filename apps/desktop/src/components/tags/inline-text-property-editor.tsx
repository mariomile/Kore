import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { cn } from '@/lib/utils'
import {
  editorSeedText,
  singleLineText,
  typedValueForText,
  type PropertyEditorProps,
} from './property-editor-shared'

/**
 * A text property edited where it is read (the note's properties panel on the
 * Mac): a click turns the wrapped value into a textarea of the same type and
 * size that grows with the text, so a long description is edited in full
 * instead of through a one-line popover. Enter or leaving the field saves,
 * Esc cancels; an untouched draft never writes. Frontmatter text is one line,
 * so a pasted line break becomes a space.
 */
export function InlineTextPropertyEditor({
  property,
  value,
  onCommit,
  children,
}: PropertyEditorProps): ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  const seed = useRef('')
  const settled = useRef(false)

  const open = (): void => {
    seed.current = editorSeedText(value)
    settled.current = false
    setDraft(seed.current)
  }

  const close = (save: boolean): void => {
    if (settled.current) {
      return
    }
    settled.current = true
    if (save && draft !== null && draft !== seed.current) {
      onCommit(typedValueForText(property, draft))
    }
    setDraft(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(false)
    }
  }

  if (draft === null) {
    return (
      <button
        type="button"
        aria-label={`Edit ${property.name}`}
        onClick={(event) => {
          event.stopPropagation()
          open()
        }}
        className="flex w-full min-w-0 self-stretch text-left focus-visible:outline-none"
      >
        {children}
      </button>
    )
  }

  return (
    <textarea
      autoFocus
      rows={1}
      value={draft}
      aria-label={property.name}
      placeholder={property.name}
      onFocus={(event) => {
        const end = event.currentTarget.value.length
        event.currentTarget.setSelectionRange(end, end)
      }}
      onChange={(event) => setDraft(singleLineText(event.target.value))}
      onKeyDown={handleKeyDown}
      onBlur={() => close(true)}
      className={cn(
        'field-sizing-content block min-h-7 w-full min-w-0 flex-1 resize-none rounded-md bg-input-bg px-1.5 py-1 ring-1 ring-border-focus ring-inset',
        'text-[13px] leading-5 text-text outline-none placeholder:text-text-muted',
      )}
    />
  )
}
