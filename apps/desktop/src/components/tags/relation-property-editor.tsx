import { useState, type ReactElement } from 'react'
import { relationTarget, relationValue } from '@reflect/core'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent } from '@/components/ui/popover'
import {
  EditorTrigger,
  useRelationSuggestions,
  type PropertyEditorProps,
} from './property-editor-shared'

/**
 * A relation property points at another note. The editor is a note picker
 * over the same verified `[[` autocomplete the editor uses
 * (`suggestWikiLinkTargets` — every offered target is proven to resolve),
 * and the committed value is the wiki link `[[insertText]]`, so the
 * reference reads the same inside and outside the app.
 */
export function RelationPropertyEditor({
  property,
  value,
  onCommit,
  onOpenRelation,
  children,
  align,
}: PropertyEditorProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const currentTarget = value === undefined ? null : relationTarget(value.value)
  const suggestions = useRelationSuggestions(open, query)

  const choose = (insertText: string): void => {
    onCommit(relationValue(insertText))
    setOpen(false)
  }
  const clear = (): void => {
    onCommit(undefined)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setQuery('')
        }
      }}
    >
      <EditorTrigger name={property.name}>{children}</EditorTrigger>
      <PopoverContent align={align ?? 'start'} sideOffset={4} className="w-64 p-0">
        {/* The DB already filtered; cmdk must not second-guess the ranking. */}
        <Command label={`Link ${property.name}`} shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Link to a note…"
            autoFocus
          />
          <CommandList>
            <CommandEmpty>
              {query === '' ? 'Type to find a note.' : 'No matching notes.'}
            </CommandEmpty>
            <CommandGroup>
              {currentTarget !== null && onOpenRelation !== undefined && query === '' ? (
                <CommandItem
                  value="__open"
                  onSelect={() => {
                    setOpen(false)
                    onOpenRelation(currentTarget)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">Open “{currentTarget}”</span>
                </CommandItem>
              ) : null}
              {suggestions.map((suggestion) => (
                <CommandItem
                  key={`${suggestion.target}:${suggestion.alias ?? ''}`}
                  value={suggestion.insertText}
                  onSelect={() => choose(suggestion.insertText)}
                >
                  <span className="min-w-0 flex-1 truncate">{suggestion.title}</span>
                  {suggestion.alias !== null ? (
                    <span className="shrink-0 text-xs text-text-muted">{suggestion.alias}</span>
                  ) : null}
                </CommandItem>
              ))}
              {value !== undefined ? (
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
