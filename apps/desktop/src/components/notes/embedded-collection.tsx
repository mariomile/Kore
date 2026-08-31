import { useCallback, useMemo, useState, type ReactElement } from 'react'
import {
  foldTag,
  type CollectionEmbed,
  type CollectionEmbedView,
  type CollectionSort,
} from '@reflect/core'
import { isModEvent } from '@meowdown/core'
import { ExternalLink } from '@/components/icons'
import { CollectionBoard, groupableProperties } from '@/components/all-notes/collection-board'
import { calendarProperty, CollectionCalendar } from '@/components/all-notes/collection-calendar'
import { CollectionTable } from '@/components/all-notes/collection-table'
import { applyCollectionFilters } from '@/components/all-notes/collection-filter-menu'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import { useCollection } from '@/hooks/use-collection'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { useTagType } from '@/hooks/use-tag-type'
import { useListSelection } from '@/lib/selection/use-list-selection'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'
import { routeForPath } from '@/routing/route'

interface EmbeddedCollectionProps {
  embed: CollectionEmbed
}

const VIEW_LABEL: Record<CollectionEmbedView, string> = {
  table: 'Table',
  board: 'Board',
  calendar: 'Calendar',
}

/**
 * Live Collection widget for one ` ```collection ` fence in a note. The fence
 * stays in the markdown (portable, editable); this is the rendered view
 * underneath the editor. Falls back to the table when the requested view
 * needs a property the tag does not declare.
 */
export function EmbeddedCollection({ embed }: EmbeddedCollectionProps): ReactElement {
  const tagType = useTagType(embed.tag)
  const { navigate } = useRouter()
  const navigateNoteLink = useNoteLinkNavigation()
  // The fence's own arrangement seeds the widget; a header click still
  // re-sorts this render of it (the fence text is not rewritten).
  const [sort, setSort] = useState<CollectionSort | null>(embed.sort)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [editingSchema, setEditingSchema] = useState(false)
  const unfiltered = useCollection(tagType ? embed.tag : null, sort)
  const entries = useMemo(() => {
    if (unfiltered === undefined || tagType === null || tagType === undefined) {
      return unfiltered
    }
    // The fence's filter lines share the filter menu's vocabulary, so the
    // one applier serves both surfaces.
    return applyCollectionFilters(tagType, unfiltered, embed.filters)
  }, [unfiltered, tagType, embed.filters])
  const orderedPaths = useMemo(() => (entries ?? []).map((entry) => entry.path), [entries])
  const selection = useListSelection(orderedPaths)

  const openNote = useCallback(
    (path: string, event?: ModClickEvent) =>
      navigateNoteLink({
        target: routeForPath(path),
        openInNewWindow: event !== undefined && isModEvent(event),
      }),
    [navigateNoteLink],
  )

  const boardProperty =
    tagType !== null && tagType !== undefined ? (groupableProperties(tagType)[0] ?? null) : null
  const dateProperty = tagType !== null && tagType !== undefined ? calendarProperty(tagType) : null
  const view: CollectionEmbedView =
    embed.view === 'board' && boardProperty === null
      ? 'table'
      : embed.view === 'calendar' && dateProperty === null
        ? 'table'
        : embed.view

  return (
    <section
      aria-label={`Collection #${embed.tag}`}
      data-testid="collection-embed"
      data-collection-tag={foldTag(embed.tag)}
      data-collection-view={view}
      className="mt-6 overflow-hidden rounded-lg border border-border"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">#{embed.tag}</p>
          <p className="text-2xs text-text-muted">{VIEW_LABEL[view]}</p>
        </div>
        <button
          type="button"
          aria-label={`Open #${embed.tag} in All Notes`}
          className="flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text"
          onClick={() => navigate({ kind: 'allNotes', tag: embed.tag })}
        >
          <ExternalLink aria-hidden className="size-3.5" />
        </button>
      </header>
      <div
        className={cn(
          'max-h-[min(28rem,70vh)] min-h-40 overflow-auto',
          view === 'table' && 'min-h-52',
        )}
      >
        {tagType === undefined ? (
          <p className="px-3 py-6 text-sm text-text-muted">Loading collection…</p>
        ) : tagType === null ? (
          <p className="px-3 py-6 text-sm text-text-muted">
            #{embed.tag} is not a typed tag, so it has no collection to embed.
          </p>
        ) : view === 'calendar' && dateProperty !== null ? (
          <CollectionCalendar
            entries={entries}
            property={dateProperty}
            tag={embed.tag}
            type={tagType}
            onOpen={openNote}
          />
        ) : view === 'board' && boardProperty !== null ? (
          <CollectionBoard
            entries={entries}
            tag={embed.tag}
            type={tagType}
            property={boardProperty}
            onOpen={openNote}
          />
        ) : (
          <CollectionTable
            entries={entries}
            tag={embed.tag}
            type={tagType}
            selection={selection}
            sort={sort}
            onSortChange={setSort}
            columnWidths={columnWidths}
            onColumnWidthChange={(key, rem) =>
              setColumnWidths((current) => ({ ...current, [key]: rem }))
            }
            onEditSchema={() => setEditingSchema(true)}
            onOpen={openNote}
            registerScrollToIndex={() => {}}
          />
        )}
      </div>
      {editingSchema ? (
        <TagConfigDialog tag={embed.tag} onClose={() => setEditingSchema(false)} />
      ) : null}
    </section>
  )
}
