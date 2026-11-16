import { z } from 'zod'
import { COLLECTION_EMBED_VIEWS, type CollectionEmbedView } from '../tags/collection-embed'
import {
  collectionSortChainSchema,
  savedCollectionViewSchema,
  type CollectionPageView,
  type CollectionSortSetting,
  type SavedCollectionView,
} from '../tags/tag-views'

// The saved-view shapes live beside the tag type that stores them
// (`tags/<type>.md`, `views:`); re-exported so settings readers keep one import.
export {
  COLLECTION_PAGE_VIEWS,
  collectionSortChainSchema,
  collectionSortSettingSchema,
  savedCollectionViewSchema,
  type CollectionPageView,
  type CollectionSortSetting,
  type SavedCollectionView,
  type SavedCollectionViewFilter,
} from '../tags/tag-views'

/**
 * Tags pinned as one-click filters on the All Notes screen, in display order.
 * The defaults mirror the original app's built-in filter tabs (book/link/
 * person); the screen offers every other tag through its Custom menu, so an
 * empty list still filters fine. Matching is case-insensitive at the query —
 * entries here keep whatever casing the user typed.
 */
export const allNotesFilterTagsSchema = z.array(z.string()).catch(['book', 'link', 'person'])

export type AllNotesFilterTags = z.infer<typeof allNotesFilterTagsSchema>

/**
 * How the All Notes screen lays out its notes: the classic table (desktop) /
 * swipeable row list (mobile), or a masonry card grid. One view preference
 * shared across surfaces.
 */
/**
 * All Notes layout. `table` is the Collection view (TDR 0005) — offered only
 * while the routed tag has a type; `board` groups the same collection by its
 * first select property, so it additionally needs one in the schema. Screens
 * without the prerequisite render `list`.
 */
const ALL_NOTES_VIEWS = ['list', ...COLLECTION_EMBED_VIEWS] as const

const allNotesViewValueSchema = z.enum(ALL_NOTES_VIEWS)

export const allNotesViewSchema = allNotesViewValueSchema.catch('list')

export type AllNotesView = z.infer<typeof allNotesViewSchema>

/**
 * The All Notes list's sort order: most/least recently updated (by `mtime`,
 * the list's only recency signal — there is no `createdAt`), or title
 * alphabetical either direction. Pinned notes always lead regardless of sort
 * (see `sortNoteList`); this only orders the rest.
 */
export const ALL_NOTES_SORTS = ['updated-desc', 'updated-asc', 'title-asc', 'title-desc'] as const

export const allNotesSortSchema = z.enum(ALL_NOTES_SORTS).catch('updated-desc')

export type AllNotesSort = z.infer<typeof allNotesSortSchema>

/**
 * The collection view an All Notes view persists as in an embed fence: the
 * note-centric list collapses to the table; the collection lenses keep their
 * identity. The one mapping shared by saved views and their menu labels.
 */
export function collectionViewForAllNotesView(view: AllNotesView): CollectionEmbedView {
  return view === 'list' ? 'table' : view
}

/**
 * The collection page tab an All Notes view persists as: list collapses to
 * the table (a tag page has no separate list); grid stays grid.
 */
export function collectionPageViewForAllNotesView(view: AllNotesView): CollectionPageView {
  return view === 'list' ? 'table' : view
}

export type CollectionSorts = Record<string, CollectionSortSetting[]>

/**
 * The Collection view's sort per folded tag key (TDR 0005) — a view
 * preference, like task filters, so leaving and returning to a collection
 * keeps its order. Global across graphs (a sort is workflow, not note
 * content); an absent key means the list's own recall order. Resilience is
 * per entry: a corrupt value is dropped while the rest load.
 */
export const collectionSortsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const sorts: CollectionSorts = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      const parsed = collectionSortChainSchema.safeParse(value)
      if (parsed.success && parsed.data.length > 0) {
        sorts[tagKey] = parsed.data
      }
    }
    return sorts
  })

/**
 * The view mode per typed tag (folded key) — on that tag's route it
 * overrides the global {@link allNotesViewSchema} choice, so the board you
 * left on #task doesn't chase you onto #book. Same per-entry resilience as
 * the other collection records.
 */
export const collectionViewModesSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const modes: Record<string, AllNotesView> = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      const parsed = allNotesViewValueSchema.safeParse(value)
      if (parsed.success) {
        modes[tagKey] = parsed.data
      }
    }
    return modes
  })

/**
 * Which named collection view is selected, per folded tag key. Absent means
 * the first saved view (or the synthetic live table when none are saved).
 * Same per-entry resilience as {@link collectionViewModesSchema}.
 */
export const collectionActiveViewIdSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const ids: Record<string, string> = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      if (typeof value === 'string' && value !== '') {
        ids[tagKey] = value
      }
    }
    return ids
  })

export type CollectionActiveViewId = Record<string, string>

/** Saved views per folded tag key, per-entry resilient at both levels. */
export const collectionSavedViewsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const views: Record<string, SavedCollectionView[]> = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      if (!Array.isArray(value)) {
        continue
      }
      const parsed: SavedCollectionView[] = []
      for (const entry of value) {
        const view = savedCollectionViewSchema.safeParse(entry)
        if (view.success) {
          parsed.push(view.data)
        }
      }
      if (parsed.length > 0) {
        views[tagKey] = parsed
      }
    }
    return views
  })

/** One Collection table's column layout: hidden property keys and manual
 * column widths (rem). Both empty by default — the schema's order and the
 * type-derived widths rule until the user touches a column. */
export interface CollectionColumnsSetting {
  hidden: string[]
  widths: Record<string, number>
}

export type CollectionColumns = Record<string, CollectionColumnsSetting>

const collectionColumnsEntrySchema = z.object({
  hidden: z.array(z.string()).catch([]),
  widths: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((entries) => {
      const widths: Record<string, number> = {}
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          widths[key] = value
        }
      }
      return widths
    }),
})

/** Per-tag Collection column layout, same per-entry resilience as
 * {@link collectionSortsSchema}. */
export const collectionColumnsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const columns: CollectionColumns = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      const parsed = collectionColumnsEntrySchema.safeParse(value)
      if (parsed.success) {
        columns[tagKey] = parsed.data
      }
    }
    return columns
  })

/** The board's grouping property per typed tag (folded tag key → property
 * key). Absent = the schema's first `select`. Same per-entry resilience as
 * {@link collectionSortsSchema}; a key the schema no longer declares (or that
 * is no longer a select) simply falls back at render time. */
export type CollectionGroups = Record<string, string>

export const collectionGroupsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const groups: CollectionGroups = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      if (typeof value === 'string' && value !== '') {
        groups[tagKey] = value
      }
    }
    return groups
  })

/**
 * The table view's row grouping per typed tag (folded tag key → property
 * key), Plan 29 V1b. Unlike the board's ({@link collectionGroupsSchema}),
 * absence means *ungrouped* — the flat table is the default, not the first
 * groupable property. Same per-entry resilience; a key the schema no longer
 * declares as groupable simply renders flat at view time.
 */
export const collectionTableGroupsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const groups: CollectionGroups = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      if (typeof value === 'string' && value !== '') {
        groups[tagKey] = value
      }
    }
    return groups
  })

/**
 * One saved ⌘K search: the query verbatim, including any filter tokens
 * (`#tag`, `is:pinned`, `links:` …). Displayed as its own text — a query like
 * `#book is:pinned` reads better than any label a save dialog would ask for.
 */
export const savedSearchSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
})

export type SavedSearch = z.infer<typeof savedSearchSchema>

/**
 * The user's saved searches, shown in the empty command palette for one-click
 * recall. Global across graphs — a query is workflow, not note content.
 * Resilience is per entry: a corrupt entry is dropped while the rest load,
 * and a non-array value degrades to the empty list.
 */
export const savedSearchesSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = savedSearchSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
  )
