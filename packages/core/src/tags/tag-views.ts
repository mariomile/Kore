import { z } from 'zod'

/**
 * A type's saved database views (organization point 3): the named tabs of a
 * tag page, each a bundle of layout, sort, grouping and filters. A type keeps
 * them in its own definition note (`tags/<type>.md`, under `views:`), so they
 * travel with the vault: every device, `kore` and agents see the same tabs.
 * Untyped tags have no definition note and keep theirs in local settings,
 * which use the same shapes (`../settings/schema-collections.ts`).
 */

/**
 * Layouts a collection page can persist as a named view (the tag-page tabs).
 * Kept as the page-tab contract even though embedded collections now support
 * the same four layouts.
 */
export const COLLECTION_PAGE_VIEWS = ['table', 'board', 'calendar', 'grid'] as const

export type CollectionPageView = (typeof COLLECTION_PAGE_VIEWS)[number]

/** One Collection's persisted sort: the property key and direction. */
export const collectionSortSettingSchema = z.object({
  key: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
})
export type CollectionSortSetting = z.infer<typeof collectionSortSettingSchema>

/**
 * A sort chain: the second key breaks the first's ties. Stored as an array;
 * a pre-chain single object still parses as a one-key chain.
 */
export const collectionSortChainSchema = z
  .union([z.array(collectionSortSettingSchema), collectionSortSettingSchema])
  .transform((value) => (Array.isArray(value) ? value : [value]))

/** One condition of a saved collection view (mirrors the desktop's
 * CollectionFilter shape — key, operator, comparison text). */
const savedViewFilterSchema = z.object({
  key: z.string().min(1),
  operator: z.enum(['is', 'contains', 'gt', 'lt', 'empty', 'notEmpty']),
  text: z.string(),
})
export type SavedCollectionViewFilter = z.infer<typeof savedViewFilterSchema>

/**
 * One saved collection view (TDR 0005): a named bundle of view mode, sort,
 * board grouping, and filters — applying it restores the whole lens in one
 * click. Malformed filters drop individually; a malformed view drops whole.
 */
export const savedCollectionViewSchema = z.preprocess(
  (value) =>
    typeof value === 'object' && value !== null && 'sort' in value && !('sorts' in value)
      ? { ...value, sorts: (value as { sort: unknown }).sort ?? [] }
      : value,
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    view: z.enum(COLLECTION_PAGE_VIEWS),
    /** The sort chain; pre-chain saves carried one `sort` object or null. */
    sorts: collectionSortChainSchema.catch([]),
    group: z.string().nullable().catch(null),
    /** How the filters combine: every one must hold, or any one. */
    match: z.enum(['all', 'any']).catch('all'),
    /** The table's row grouping (Plan 29 V1b); `null` = flat rows. Absent in
     * pre-V1b saves, so the catch keeps them applying as they always did. */
    tableGroup: z.string().nullable().catch(null),
    filters: z
      .array(z.unknown())
      .catch([])
      .transform((entries) => {
        const filters: SavedCollectionViewFilter[] = []
        for (const entry of entries) {
          const parsed = savedViewFilterSchema.safeParse(entry)
          if (parsed.success) {
            filters.push(parsed.data)
          }
        }
        return filters
      }),
  }),
)
export type SavedCollectionView = z.infer<typeof savedCollectionViewSchema>

/** The frontmatter key a definition note keeps its saved views under. */
export const TAG_VIEWS_KEY = 'views'

/**
 * Read a definition's `views:` value. Tolerant like every frontmatter read: a
 * malformed view is dropped, a repeated id keeps its first occurrence.
 */
export function parseTagViews(value: unknown): SavedCollectionView[] {
  if (!Array.isArray(value)) {
    return []
  }
  const views: SavedCollectionView[] = []
  const ids = new Set<string>()
  for (const entry of value) {
    const parsed = savedCollectionViewSchema.safeParse(entry)
    if (parsed.success && !ids.has(parsed.data.id)) {
      ids.add(parsed.data.id)
      views.push(parsed.data)
    }
  }
  return views
}

/**
 * The YAML a definition note stores for its views, key by key so the block's
 * shape is this module's contract. Defaults are left out (`match: all`, no
 * grouping, no sort, no filters) to keep the file short and readable.
 */
export function tagViewsToYaml(views: readonly SavedCollectionView[]): Record<string, unknown>[] {
  return views.map((view) => ({
    id: view.id,
    name: view.name,
    view: view.view,
    ...(view.sorts.length === 0
      ? {}
      : { sorts: view.sorts.map((sort) => ({ key: sort.key, direction: sort.direction })) }),
    ...(view.group === null ? {} : { group: view.group }),
    ...(view.tableGroup === null ? {} : { tableGroup: view.tableGroup }),
    ...(view.filters.length === 0
      ? {}
      : {
          filters: view.filters.map((filter) => ({
            key: filter.key,
            operator: filter.operator,
            text: filter.text,
          })),
        }),
    ...(view.match === 'all' ? {} : { match: view.match }),
  }))
}
