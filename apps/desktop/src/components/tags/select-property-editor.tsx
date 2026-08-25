import { useState, type ReactElement } from 'react'
import { Check } from '@/components/icons'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { EditorTrigger, editorSeedList, type PropertyEditorProps } from './property-editor-shared'

/** A select/multiselect editor: the schema's options in a command list. */
export function SelectPropertyEditor({
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
      <EditorTrigger name={property.name}>{children}</EditorTrigger>
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
