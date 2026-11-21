import { useState, type ReactElement, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  foldTag,
  isTagName,
  listTagTypes,
  suggestTags,
  tagDisplayName,
  type TagType,
} from '@kore/core'
import { Plus, Search } from '@/components/icons'
import { TagIcon } from '@/components/tags/tag-icon'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { tagTypesQueryKey } from '@/hooks/use-tag-icons'
import { isMobileSurface } from '@/lib/platform-surface'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** One offered tag: what would be written, with its schema when it has one. */
interface TagOption {
  /** The exact string `addNoteTag` would write. */
  tag: string
  tagKey: string
  type: TagType | null
}

interface TagPickerOptions {
  configured: TagOption[]
  others: TagOption[]
  fresh: string | null
}

function useTagPickerOptions(
  open: boolean,
  query: string,
  carried: readonly string[],
): TagPickerOptions {
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
  const configured: TagOption[] = (typed ?? [])
    .filter((entry) => !taken.has(entry.tagKey) && entry.tagKey.includes(needle))
    .map((entry) => ({
      tag: entry.tagKey,
      tagKey: entry.tagKey,
      type: entry.type,
    }))
  const configuredKeys = new Set(configured.map((option) => option.tagKey))
  const others: TagOption[] = (suggested ?? [])
    .map((suggestion) => ({
      tag: suggestion.tag,
      tagKey: foldTag(suggestion.tag),
      type: null,
    }))
    .filter((option) => !taken.has(option.tagKey) && !configuredKeys.has(option.tagKey))
  const freshCandidate =
    needle !== '' && isTagName(needle) && !taken.has(needle) && !configuredKeys.has(needle)
      ? needle
      : null
  const fresh =
    freshCandidate !== null && !others.some((option) => option.tagKey === freshCandidate)
      ? freshCandidate
      : null

  return { configured, others, fresh }
}

export interface NoteTagPickerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Folded keys the note already carries — never offered twice. */
  carried: readonly string[]
  onChoose: (tag: string) => void
}

/**
 * Native bottom sheet for picking or creating a `#tag` on mobile
 * (TDR 0005 Amendment I). Shared by the note header's `+` button, the keyboard
 * toolbar's `#` action on regular notes, and `⋯ → Tags`.
 */
export function NoteTagPickerDrawer({
  open,
  onOpenChange,
  carried,
  onChoose,
}: NoteTagPickerDrawerProps): ReactElement {
  const [query, setQuery] = useState('')
  const { configured, others, fresh } = useTagPickerOptions(open, query, carried)

  const handleOpenChange = (next: boolean): void => {
    onOpenChange(next)
    if (!next) {
      setQuery('')
    }
  }

  const choose = (tag: string): void => {
    handleOpenChange(false)
    onChoose(tag)
  }

  const hasResults = configured.length > 0 || others.length > 0 || fresh !== null

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent>
        <DrawerTitle className="px-4 pt-3">Add tag</DrawerTitle>
        <div className="px-4 pb-2 pt-3">
          <div className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3">
            <Search aria-hidden className="size-4 shrink-0 text-text-muted" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search or create tag…"
              aria-label="Search or create tag"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-base text-text placeholder:text-text-muted focus:outline-none"
            />
          </div>
        </div>
        <DrawerBody className="px-4 pb-4 pt-2">
          {!hasResults ? (
            <p className="py-6 text-center text-sm text-text-muted">No matching tag.</p>
          ) : null}
          {configured.length > 0 ? (
            <div className="flex flex-col">
              {configured.map((option) => (
                <button
                  key={option.tagKey}
                  type="button"
                  onClick={() => choose(option.tag)}
                  className="flex h-12 items-center gap-3 rounded-xl px-2 text-left text-base active:bg-surface-hover"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center">
                    <TagIcon
                      icon={option.type?.icon}
                      className="size-[18px] text-text-muted"
                      emojiClassName="text-[18px]"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{tagDisplayName(option.tag)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {configured.length > 0 && others.length > 0 ? (
            <div role="separator" className="my-2 border-t border-border/60" />
          ) : null}
          {others.length > 0 ? (
            <div className="flex flex-col">
              {others.map((option) => (
                <button
                  key={option.tagKey}
                  type="button"
                  onClick={() => choose(option.tag)}
                  className="flex h-12 items-center gap-3 rounded-xl px-2 text-left text-base active:bg-surface-hover"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center">
                    <TagIcon icon={undefined} className="size-[18px] text-text-muted" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{tagDisplayName(option.tag)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {fresh !== null ? (
            <div className="mt-1 flex flex-col">
              <button
                type="button"
                onClick={() => choose(fresh)}
                className="flex h-12 items-center gap-3 rounded-xl px-2 text-left text-base font-medium text-accent active:bg-surface-hover"
              >
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <Plus aria-hidden className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">Create #{fresh}</span>
              </button>
            </div>
          ) : null}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}

interface NoteTypePickerProps {
  /** Folded keys the note already carries — never offered twice. */
  carried: readonly string[]
  onChoose: (tag: string) => void
  /** Accessible name of the control that opens the picker. */
  triggerLabel: string
  triggerClassName?: string
  /** What the trigger shows. */
  children: ReactNode
}

/**
 * The picker behind the note's Tags row: choose or create a `#tag` for the
 * note instead of typing the hashtag into prose. Configured tags (those with a
 * definition note) come first, followed by every other tag ranked most-used
 * first. Renders a popover on desktop and a native bottom sheet on mobile.
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
  const mobile = isMobileSurface()
  const { configured, others, fresh } = useTagPickerOptions(!mobile && open, query, carried)

  if (mobile) {
    return (
      <>
        <button
          type="button"
          aria-label={triggerLabel}
          className={triggerClassName}
          onClick={() => setOpen(true)}
        >
          {children}
        </button>
        <NoteTagPickerDrawer
          open={open}
          onOpenChange={setOpen}
          carried={carried}
          onChoose={onChoose}
        />
      </>
    )
  }

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
        <Command label="Add a tag" shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Add a tag…" autoFocus />
          <CommandList>
            <CommandEmpty>No matching tag.</CommandEmpty>
            {configured.length > 0 ? (
              <CommandGroup heading={others.length > 0 ? 'Configured' : undefined}>
                {configured.map((option) => (
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
              <CommandGroup heading={configured.length > 0 ? 'Other tags' : undefined}>
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
            {fresh !== null ? (
              <CommandGroup>
                <CommandItem value="__fresh" onSelect={() => choose(fresh)}>
                  <span className="min-w-0 flex-1 truncate">Create #{fresh}</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
