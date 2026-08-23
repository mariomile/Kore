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
      property.type === 'number' &&
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
    property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : 'text'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          cancelled.current = false
          seed.current = editorSeedText(value)
          setDraft(seed.current)
        }
      }}
    >
      <PopoverTrigger
        aria-label={`Edit ${property.name}`}
        className="flex min-h-5 w-full min-w-0 items-center self-stretch text-left focus-visible:outline-none"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align={align ?? 'start'} sideOffset={4} className="w-56 p-2">
        <Input
          ref={inputRef}
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
  // Toggles work against a local copy seeded when the popover opens: the
  // `value` prop only refreshes after write → watcher → refetch, so two
  // quick toggles would otherwise both start from the stale stored list and
  // the second commit would clobber the first.
  const [localSelected, setLocalSelected] = useState<string[] | null>(null)
  const selected = localSelected ?? editorSeedList(value)
  const options = [...new Set([...(property.options ?? []), ...selected])]

  const chooseSingle = (option: string): void => {
    // Re-picking the current value clears it — one gesture for set and unset.
    onCommit(selected.length === 1 && selected[0] === option ? undefined : option)
    setOpen(false)
  }
  const clear = (): void => {
    onCommit(undefined)
    setOpen(false)
  }
  const toggleMultiple = (option: string): void => {
    const next = selected.includes(option)
      ? selected.filter((entry) => entry !== option)
      : [...selected, option]
    setLocalSelected(next)
    onCommit(next.length === 0 ? undefined : next)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setLocalSelected(next ? editorSeedList(value) : null)
      }}
    >
      <PopoverTrigger
        aria-label={`Edit ${property.name}`}
        className="flex min-h-5 w-full min-w-0 items-center self-stretch text-left focus-visible:outline-none"
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
                <CommandItem value="__clear" onSelect={clear}>
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
      className="flex min-h-5 min-w-0 items-center self-stretch focus-visible:outline-none"
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
