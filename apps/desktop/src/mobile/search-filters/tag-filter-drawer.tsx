import { useState, type ReactElement } from 'react'
import { foldTag, tagDisplayName, type NoteTagFacet } from '@kore/core'
import { Check, ChevronRight } from '@/components/icons'
import { TagIcon } from '@/components/tags/tag-icon'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { useTagIcons, useTagTypes } from '@/hooks/use-tag-icons'
import { SearchInput } from '@/mobile/search-input'
import { cn } from '@/lib/utils'

interface TagFilterDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Every tag in the graph (display casing + note count). */
  facets: NoteTagFacet[]
  /** The selected folded tag keys. */
  selected: string[]
  /** Toggle one folded tag key in or out of the selection. */
  onToggle: (tagKey: string) => void
  /** Open a tag's page (display casing). */
  onOpen: (tag: string) => void
}

/**
 * The Tags sheet (TDR 0005 Amendment I): configured tags pinned at top above a
 * divider, followed by every other tag, with a search input for large vaults.
 * Tapping a row opens the tag's page (table, board, calendar, gallery); the
 * round control at the end narrows the Notes list to that tag instead.
 */
export function TagFilterDrawer({
  open,
  onOpenChange,
  facets,
  selected,
  onToggle,
  onOpen,
}: TagFilterDrawerProps): ReactElement {
  const [query, setQuery] = useState('')
  const icons = useTagIcons()
  const configuredTypes = useTagTypes(open)
  const configuredKeys = new Set(configuredTypes.map((entry) => entry.tagKey))
  const needle = foldTag(query.trim())

  const filtered = facets.filter((facet) => {
    if (needle === '') return true
    const key = foldTag(facet.tag)
    return key.includes(needle) || tagDisplayName(facet.tag).toLowerCase().includes(needle)
  })
  const configured = filtered.filter((facet) => configuredKeys.has(foldTag(facet.tag)))
  const others = filtered.filter((facet) => !configuredKeys.has(foldTag(facet.tag)))

  const handleOpenChange = (next: boolean): void => {
    onOpenChange(next)
    if (!next) {
      setQuery('')
    }
  }

  const renderRow = (facet: NoteTagFacet): ReactElement => {
    const key = foldTag(facet.tag)
    const isSelected = selected.includes(key)
    const name = tagDisplayName(facet.tag)
    return (
      <div key={key} className="flex h-12 items-center gap-1">
        <button
          type="button"
          onClick={() => onOpen(facet.tag)}
          className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left text-base active:bg-surface-hover"
        >
          <span className="flex size-6 shrink-0 items-center justify-center">
            <TagIcon
              icon={icons.get(key)}
              className="size-[18px] text-text-muted"
              emojiClassName="text-[18px]"
            />
          </span>
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="text-[13px] tabular-nums text-text-muted">{facet.count}</span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
        </button>
        <button
          type="button"
          aria-label={`Filter notes by #${key}`}
          aria-pressed={isSelected}
          onClick={() => onToggle(key)}
          className="-mr-2 flex size-11 shrink-0 items-center justify-center"
        >
          <span
            aria-hidden
            className={cn(
              'flex size-[22px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 motion-reduce:transition-none',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border-strong text-transparent',
            )}
          >
            <Check className="size-3.5" strokeWidth={2.25} />
          </span>
        </button>
      </div>
    )
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent>
        <DrawerTitle className="px-4 pt-3">Tags</DrawerTitle>
        {facets.length > 0 ? (
          <div className="px-4 pb-2 pt-3">
            <SearchInput
              aria-label="Search tags"
              placeholder="Search tags…"
              value={query}
              onValueChange={setQuery}
            />
          </div>
        ) : null}
        <DrawerBody className="px-4 pb-2 pt-2">
          <p className="px-2 pb-2 text-[13px] text-text-muted">
            Open a tag, or tick it to filter your notes.
          </p>
          <div className="flex flex-col">
            {facets.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">No tags yet</p>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">No matching tags</p>
            ) : (
              <>
                {configured.map(renderRow)}
                {configured.length > 0 && others.length > 0 ? (
                  <div role="separator" className="my-2 border-t border-border/60" />
                ) : null}
                {others.map(renderRow)}
              </>
            )}
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}
