import { useState, type ReactElement, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { foldTag, isTagName, listTagTypes, suggestTags, type TagType } from '@reflect/core'
import { TagIcon } from '@/components/tags/tag-icon'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { tagTypesQueryKey } from '@/hooks/use-tag-icons'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** One offered tag: what would be written, with its schema when it has one. */
interface TypeOption {
  /** The exact string `appendBodyTag` would write. */
  tag: string
  tagKey: string
  type: TagType | null
}

interface NoteTypePickerProps {
  /** Folded keys the note already carries — never offered twice. */
  carried: readonly string[]
  onChoose: (tag: string) => void
  /** Accessible name of the control that opens the popover. */
  triggerLabel: string
  triggerClassName?: string
  /** What the trigger shows. */
  children: ReactNode
}

/**
 * The picker behind the Type field: choose what a note *is* instead of typing
 * the hashtag into its prose.
 *
 * Tags carrying a schema come first under "Types", because those are the ones
 * that bring fields with them; every other tag in the graph follows, ranked
 * most-used-first by the same `suggestTags` the editor's `#` menu uses. This
 * is a presentation order, not the "typed tag" distinction TDR 0005
 * Amendment A removed: both groups write the same membership, and a tag from
 * either grows a schema the moment one is saved on its page.
 *
 * A query naming no existing tag offers itself, since in Kore a tag exists
 * because a note carries it — there is nothing to create first.
 */
export function NoteTypePicker({
  carried,
  onChoose,
  triggerLabel,
  triggerClassName,
  children,
}: NoteTypePickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const enabled = open && bridgeReady && graph !== null

  const { data: typed } = useQuery({
    queryKey: tagTypesQueryKey(graph?.root),
    queryFn: () => listTagTypes(),
    enabled,
  })
  const { data: suggested } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'tag-suggestions', query],
    queryFn: () => suggestTags(query, 12),
    enabled,
    placeholderData: keepPreviousData,
  })

  const taken = new Set(carried)
  const needle = foldTag(query.trim())
  const types: TypeOption[] = (typed ?? [])
    .filter((entry) => !taken.has(entry.tagKey) && entry.tagKey.includes(needle))
    .map((entry) => ({
      tag: entry.tagKey,
      tagKey: entry.tagKey,
      type: entry.type,
    }))
  const typeKeys = new Set(types.map((option) => option.tagKey))
  const others: TypeOption[] = (suggested ?? [])
    .map((suggestion) => ({
      tag: suggestion.tag,
      tagKey: foldTag(suggestion.tag),
      type: null,
    }))
    .filter((option) => !taken.has(option.tagKey) && !typeKeys.has(option.tagKey))
  const fresh =
    needle !== '' && isTagName(needle) && !taken.has(needle) && !typeKeys.has(needle)
      ? needle
      : null
  const canUseFresh = fresh !== null && !others.some((option) => option.tagKey === fresh)

  const choose = (tag: string): void => {
    setOpen(false)
    setQuery('')
    onChoose(tag)
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
      <PopoverTrigger aria-label={triggerLabel} className={triggerClassName}>
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-64 p-0">
        {/* The index already ranked these; cmdk must not re-sort them. */}
        <Command label="Set the note's type" shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Set a type…"
            autoFocus
          />
          <CommandList>
            <CommandEmpty>No matching type.</CommandEmpty>
            {types.length > 0 ? (
              <CommandGroup heading="Types">
                {types.map((option) => (
                  <CommandItem
                    key={option.tagKey}
                    value={option.tagKey}
                    onSelect={() => choose(option.tag)}
                  >
                    {option.type?.icon !== undefined ? (
                      <TagIcon icon={option.type.icon} className="size-3.5 shrink-0" />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">#{option.tagKey}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {others.length > 0 ? (
              <CommandGroup heading={types.length > 0 ? 'Other types' : 'Types'}>
                {others.map((option) => (
                  <CommandItem
                    key={option.tagKey}
                    value={option.tagKey}
                    onSelect={() => choose(option.tag)}
                  >
                    <span className="min-w-0 flex-1 truncate">#{option.tag}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {canUseFresh ? (
              <CommandGroup>
                <CommandItem value="__fresh" onSelect={() => choose(fresh)}>
                  <span className="min-w-0 flex-1 truncate">Use #{fresh}</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
