import { useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import type { CollectionValue, TagProperty } from '@reflect/core'
import { Check } from '@/components/icons'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * The shared per-type property editors (TDR 0005), used by Collection cells
 * and the note's properties panel. Every editor commits through one channel:
 * `onCommit(value)` with the typed YAML value, or `undefined` to delete the
 * key — the caller routes it into the frontmatter patch.
 */

export interface PropertyEditorProps {
  property: TagProperty
  /** The stored value (from `note_properties`), or undefined when unset. */
  value: CollectionValue | undefined
  /** Persist a new value (`undefined` deletes the key). */
  onCommit: (value: unknown) => void
  /** The read-only display the editor opens from. */
  children: ReactNode
  align?: 'start' | 'end'
}

/** The stored value's text form for an input seed ('' when unset). */
export function editorSeedText(value: CollectionValue | undefined): string {
  return value === undefined || value.valueType === 'list' ? '' : value.value
}

/** The stored value as a list (for multi-select editing). */
export function editorSeedList(value: CollectionValue | undefined): string[] {
  if (value === undefined) {
    return []
  }
  if (value.valueType === 'list') {
    try {
      const entries = JSON.parse(value.value) as unknown
      if (Array.isArray(entries)) {
        return entries.map(String)
      }
    } catch {
      return []
    }
    return []
  }
  return value.value === '' ? [] : [value.value]
}

/** Convert an input's committed text into the typed YAML value. */
export function typedValueForText(property: TagProperty, text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') {
    return undefined
  }
  if (property.type === 'number') {
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return trimmed
}

/** An input-backed editor (text, url, date, number) inside a popover. */
function InputPropertyEditor({
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

  const commit = (): void => {
    if (cancelled.current) {
      return
    }
    cancelled.current = true // a blur following an Enter-commit is a no-op
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
    property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : 'text'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          cancelled.current = false
          setDraft(editorSeedText(value))
        }
      }}
    >
      <PopoverTrigger
        aria-label={`Edit ${property.name}`}
        className="flex w-full min-w-0 items-center text-left focus-visible:outline-none"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align={align ?? 'start'} sideOffset={4} className="w-56 p-2">
        <Input
          autoFocus
          type={inputType}
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

/** A select/multiselect editor: the schema's options in a command list. */
function SelectPropertyEditor({
  property,
  value,
  onCommit,
  children,
  align,
}: PropertyEditorProps): ReactElement {
  const [open, setOpen] = useState(false)
  const multiple = property.type === 'multiselect'
  const selected = editorSeedList(value)
  const options = [...new Set([...(property.options ?? []), ...selected])]

  const chooseSingle = (option: string): void => {
    // Re-picking the current value clears it — one gesture for set and unset.
    onCommit(selected.length === 1 && selected[0] === option ? undefined : option)
    setOpen(false)
  }
  const toggleMultiple = (option: string): void => {
    const next = selected.includes(option)
      ? selected.filter((entry) => entry !== option)
      : [...selected, option]
    onCommit(next.length === 0 ? undefined : next)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Edit ${property.name}`}
        className="flex w-full min-w-0 items-center text-left focus-visible:outline-none"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align={align ?? 'start'} sideOffset={4} className="w-56 p-0">
        <Command label={`Choose ${property.name}`}>
          {options.length > 6 ? <CommandInput placeholder={`Search ${property.name}…`} /> : null}
          <CommandList>
            <CommandEmpty>No options.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const active = selected.includes(option)
                return (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => (multiple ? toggleMultiple(option) : chooseSingle(option))}
                  >
                    <span className="min-w-0 flex-1 truncate">{option}</span>
                    <Check
                      aria-hidden
                      className={cn('size-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')}
                    />
                  </CommandItem>
                )
              })}
              {!multiple && selected.length > 0 ? (
                <CommandItem value="__clear" onSelect={() => chooseSingle(selected[0] ?? '')}>
                  <span className="text-text-muted">Clear</span>
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** A checkbox property edits in place — the display is the control. */
function CheckboxPropertyEditor({
  property,
  value,
  onCommit,
  children,
}: PropertyEditorProps): ReactElement {
  const checked = value?.valueType === 'boolean' && value.value === 'true'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={property.name}
      className="flex min-w-0 items-center focus-visible:outline-none"
      onClick={(event) => {
        event.stopPropagation()
        onCommit(!checked)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  )
}

/** The per-type dispatch: one editor component for any schema property. */
export function PropertyValueEditor(props: PropertyEditorProps): ReactElement {
  switch (props.property.type) {
    case 'checkbox':
      return <CheckboxPropertyEditor {...props} />
    case 'select':
    case 'multiselect':
      return <SelectPropertyEditor {...props} />
    default:
      return <InputPropertyEditor {...props} />
  }
}
