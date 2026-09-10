import type { ReactElement } from 'react'
import { foldTag, type NoteListFilter, type NoteTagFacet } from '@reflect/core'
import { useSettings } from '@/providers/settings-provider'
import { CustomFilterMenu } from './custom-filter-menu'
import { FilterTab } from './filter-tab'

interface AllNotesFiltersProps {
  filter: NoteListFilter
  /** Every tag carried by a non-daily note, for the Custom menu. */
  facets: NoteTagFacet[]
  inboxCount: number | undefined
  onSelect: (filter: NoteListFilter) => void
}

/**
 * The All Notes filter bar: an All tab, one tab per pinned tag (the
 * `allNotesFilterTags` setting), and a Custom combobox offering every
 * remaining tag plus free entry of any tag name. Tag matching is
 * case-insensitive throughout, same as the `#tag` search token.
 */
export function AllNotesFilters({
  filter,
  facets,
  inboxCount,
  onSelect,
}: AllNotesFiltersProps): ReactElement {
  const { settings } = useSettings()
  const tag = filter.kind === 'tag' ? filter.tag : null

  // The setting is user-edited JSON — dedupe case-insensitively and drop
  // blanks so a hand-edited document can't render twin or empty tabs.
  const pinned: string[] = []
  const pinnedKeys = new Set<string>()
  for (const entry of settings.allNotesFilterTags) {
    const trimmed = entry.trim()
    const key = foldTag(trimmed)
    if (key !== '' && !pinnedKeys.has(key)) {
      pinnedKeys.add(key)
      pinned.push(trimmed)
    }
  }

  const activeKey = tag === null ? null : foldTag(tag)
  const customTag = tag !== null && !pinnedKeys.has(foldTag(tag)) ? tag : null
  const customFacets = facets.filter((facet) => !pinnedKeys.has(foldTag(facet.tag)))

  return (
    <div
      role="group"
      aria-label="Filter by tag"
      className="flex items-center gap-0.5 rounded-full bg-surface-hover p-0.5"
    >
      <FilterTab
        label={inboxCount === undefined ? 'Inbox' : `Inbox · ${inboxCount}`}
        active={filter.kind === 'inbox'}
        onClick={() => onSelect({ kind: 'inbox' })}
      />
      <FilterTab
        label="All"
        active={filter.kind === 'all'}
        onClick={() => onSelect({ kind: 'all' })}
      />
      {pinned.map((pinnedTag) => (
        <FilterTab
          key={foldTag(pinnedTag)}
          label={`#${pinnedTag}`}
          active={activeKey === foldTag(pinnedTag)}
          onClick={() => onSelect({ kind: 'tag', tag: pinnedTag })}
        />
      ))}
      <CustomFilterMenu
        facets={customFacets}
        activeTag={customTag}
        onSelect={(tag) => onSelect({ kind: 'tag', tag })}
      />
    </div>
  )
}
