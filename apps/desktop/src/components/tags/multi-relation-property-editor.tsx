import { useState, type ReactElement } from 'react'
import { relationDisplay, relationTarget, relationTargetOf, relationValue } from '@reflect/core'
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
import { useGraph } from '@/providers/graph-provider'
import {
  createRelationRow,
  creatableRowTitle,
  EditorTrigger,
  editorSeedList,
  useRelationSuggestions,
  type PropertyEditorProps,
} from './property-editor-shared'

/**
 * A multi-relation property holds a list of wiki links. Same picker as the
 * single relation, but selecting toggles membership instead of replacing —
 * the local list mirrors {@link SelectPropertyEditor}'s race guard, since two
 * quick toggles both land before the watcher refreshes the stored value.
 */
export function MultiRelationPropertyEditor({
  property,
  value,
  onCommit,
  children,
  align,
}: PropertyEditorProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [localLinks, setLocalLinks] = useState<string[] | null>(null)
  const { graph } = useGraph()
  // Each entry is a stored `[[Target]]` value; a bare string (hand-written
  // YAML) still participates, keyed by its own text.
  const links = localLinks ?? editorSeedList(value)
  const targetOf = (link: string): string => relationTarget(link) ?? link
  // `person` scopes to its default collection even with no explicit target.
  const target = relationTargetOf(property)
  const suggestions = useRelationSuggestions(open, query, target)
  // Same "Create in #target" entry as the single relation's picker.
  const newRowTitle = target === undefined ? null : creatableRowTitle(query)
  const canCreate =
    newRowTitle !== null &&
    graph !== null &&
    !suggestions.some((suggestion) => suggestion.title.toLowerCase() === newRowTitle.toLowerCase())
  const createAndToggle = async (): Promise<void> => {
    if (target === undefined || newRowTitle === null || graph === null) {
      return
    }
    toggle(await createRelationRow(target, newRowTitle, graph.generation))
  }

  const toggle = (insertText: string): void => {
    const candidate = relationValue(insertText)
    const next = links.some((link) => targetOf(link) === targetOf(candidate))
      ? links.filter((link) => targetOf(link) !== targetOf(candidate))
      : [...links, candidate]
    setLocalLinks(next)
    onCommit(next.length === 0 ? undefined : next)
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
        setLocalLinks(next ? editorSeedList(value) : null)
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
            placeholder={target === undefined ? 'Link notes…' : `Link #${target} rows…`}
            autoFocus
          />
          <CommandList>
            <CommandEmpty>
              {query === '' && links.length === 0 ? 'Type to find a note.' : 'No matching notes.'}
            </CommandEmpty>
            <CommandGroup>
              {/* At rest the current links list first, so unlinking is one
                  click without retyping the title. */}
              {query === ''
                ? links.map((link) => (
                    <CommandItem
                      key={`linked:${link}`}
                      value={`linked:${link}`}
                      onSelect={() => toggle(targetOf(link))}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {relationDisplay(link) ?? link}
                      </span>
                      <Check aria-hidden className="size-3.5 shrink-0 opacity-100" />
                    </CommandItem>
                  ))
                : null}
              {suggestions
                .filter(
                  (suggestion) =>
                    query !== '' ||
                    !links.some((link) => targetOf(link) === targetOf(suggestion.insertText)),
                )
                .map((suggestion) => {
                  const active = links.some(
                    (link) => targetOf(link) === targetOf(suggestion.insertText),
                  )
                  return (
                    <CommandItem
                      key={`${suggestion.target}:${suggestion.alias ?? ''}`}
                      value={suggestion.insertText}
                      onSelect={() => toggle(suggestion.insertText)}
                    >
                      <span className="min-w-0 flex-1 truncate">{suggestion.title}</span>
                      <Check
                        aria-hidden
                        className={cn('size-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')}
                      />
                    </CommandItem>
                  )
                })}
              {canCreate ? (
                <CommandItem value="__create" onSelect={() => void createAndToggle()}>
                  <span className="min-w-0 flex-1 truncate">
                    Create “{newRowTitle}” in #{target}
                  </span>
                </CommandItem>
              ) : null}
              {links.length > 0 ? (
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
