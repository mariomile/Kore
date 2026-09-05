import { useCallback, useMemo } from 'react'
import {
  collectionViewForAllNotesView,
  type AllNotesView,
  type CollectionSort,
  type SavedCollectionView,
  type TagProperty,
  type TagType,
} from '@reflect/core'
import { useSettings } from '@/providers/settings-provider'
import { groupablePropertiesOf } from '@/lib/tags/schema-views'
import { groupableProperties } from './collection-board'
import { calendarProperty } from './collection-calendar'
import type { CollectionFilter, CollectionFilterMatch } from './collection-filter-menu'

/** Stable empty widths map, so an untouched tag never re-keys the memo. */
const EMPTY_WIDTHS: Record<string, number> = {}
/** Stable empty chain, so an unsorted tag never re-keys the collection query. */
const EMPTY_SORTS: readonly CollectionSort[] = []

/** The persisted view preferences the All Notes screen renders from. */
export interface CollectionViewSettings {
  boardProperties: TagProperty[]
  boardGroupProperty: TagProperty | null
  boardAvailable: boolean
  calendarDateProperty: TagProperty | null
  calendarAvailable: boolean
  view: AllNotesView
  setViewMode: (mode: AllNotesView) => void
  /** The views that render collection rows instead of the notes list. */
  collectionView: boolean
  /** The sort chain — the second key breaks the first's ties; empty = recall order. */
  collectionSorts: readonly CollectionSort[]
  setCollectionSorts: (sorts: readonly CollectionSort[]) => void
  setCollectionGroup: (key: string) => void
  /** The table's row grouping (Plan 29 V1b) — `null` renders flat rows. */
  tableGroupProperty: TagProperty | null
  /** What the table's Group-by offers: the single-valued groupables — the
   * board's list-tolerant `multiselect` lanes have no flat-row analogue. */
  tableGroupProperties: TagProperty[]
  setTableGroup: (key: string | null) => void
  hiddenColumns: Set<string>
  columnWidths: Record<string, number>
  /** The tag's schema with hidden columns filtered out (the table renders this). */
  visibleTagType: TagType | null
  setColumnWidth: (key: string, rem: number) => void
  toggleColumnHidden: (key: string) => void
}

/**
 * The All Notes screen's persisted view preferences for one routed tag (or
 * the global list): the active layout, the collection sort, the board
 * grouping, and the table's column layout — each read from and written to
 * settings. `tagType` is the routed tag's schema (zero properties while the
 * tag has no definition note), `null` only on the unfiltered list, where the
 * Collection views are unavailable.
 */
export function useCollectionViewSettings(
  tagKey: string | null,
  tagType: TagType | null,
): CollectionViewSettings {
  const { settings, updateSettings, updateSettingsWith } = useSettings()
  const collectionAvailable = tagType !== null
  // The board additionally needs a groupable property (select, checkbox, or
  // relation). Which one is a persisted per-tag choice (like the sort); a
  // saved key the schema no longer declares as groupable falls back to the
  // first, never a blank board.
  const boardProperties = useMemo(
    () => (collectionAvailable ? groupableProperties(tagType) : []),
    [collectionAvailable, tagType],
  )
  const savedGroupKey = tagKey === null ? undefined : settings.collectionGroups[tagKey]
  const boardGroupProperty =
    boardProperties.find((property) => property.key === savedGroupKey) ?? boardProperties[0] ?? null
  const boardAvailable = boardGroupProperty !== null
  // The calendar needs a date property to place rows by.
  const calendarDateProperty = collectionAvailable ? calendarProperty(tagType) : null
  const calendarAvailable = calendarDateProperty !== null
  // On a tag route, that tag's own persisted view mode wins over the global
  // preference — the board you left on one tag doesn't chase you onto the
  // next; the toggles write per-tag there, global elsewhere.
  const requestedView =
    (tagKey === null ? undefined : settings.collectionViewModes[tagKey]) ?? settings.allNotesView
  // A tag has exactly one table — the collection's own. The plain notes
  // list belongs to the unfiltered page, so a stored (or default) 'list'
  // renders as the collection table here, and the switcher never offers two
  // tables side by side.
  const view =
    (requestedView === 'table' && !collectionAvailable) ||
    (requestedView === 'board' && !boardAvailable) ||
    (requestedView === 'calendar' && !calendarAvailable)
      ? 'list'
      : requestedView === 'list' && collectionAvailable
        ? 'table'
        : requestedView
  const setViewMode = useCallback(
    (mode: AllNotesView) => {
      if (tagKey === null) {
        updateSettings({ allNotesView: mode })
      } else {
        updateSettingsWith((current) => ({
          collectionViewModes: { ...current.collectionViewModes, [tagKey]: mode },
        }))
      }
    },
    [tagKey, updateSettings, updateSettingsWith],
  )
  // The views that render collection rows instead of the notes list.
  const collectionView = view === 'table' || view === 'board' || view === 'calendar'
  // The sort chain is a persisted per-tag view preference (like task
  // filters): leaving and returning to a collection keeps its order.
  const collectionSorts: readonly CollectionSort[] =
    tagKey === null ? EMPTY_SORTS : (settings.collectionSorts[tagKey] ?? EMPTY_SORTS)
  const setCollectionSorts = useCallback(
    (sorts: readonly CollectionSort[]) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => {
        const next = { ...current.collectionSorts }
        if (sorts.length === 0) {
          delete next[tagKey]
        } else {
          next[tagKey] = [...sorts]
        }
        return { collectionSorts: next }
      })
    },
    [tagKey, updateSettingsWith],
  )
  const setCollectionGroup = useCallback(
    (key: string) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => ({
        collectionGroups: { ...current.collectionGroups, [tagKey]: key },
      }))
    },
    [tagKey, updateSettingsWith],
  )
  // The table's row grouping (Plan 29 V1b): per-tag like the board's, but
  // absence means *flat* — no first-groupable fallback, since the flat table
  // is a first-class shape, not a degraded one.
  const tableGroupProperties = useMemo(
    () => (collectionAvailable ? groupablePropertiesOf(tagType.properties) : []),
    [collectionAvailable, tagType],
  )
  const savedTableGroupKey = tagKey === null ? undefined : settings.collectionTableGroups[tagKey]
  const tableGroupProperty =
    tableGroupProperties.find((property) => property.key === savedTableGroupKey) ?? null
  const setTableGroup = useCallback(
    (key: string | null) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => {
        const next = { ...current.collectionTableGroups }
        if (key === null) {
          delete next[tagKey]
        } else {
          next[tagKey] = key
        }
        return { collectionTableGroups: next }
      })
    },
    [tagKey, updateSettingsWith],
  )
  // Column layout (hidden keys, manual widths) is a persisted per-tag view
  // preference like the sort; the table renders the visible subset.
  const columnsSetting = tagKey === null ? undefined : settings.collectionColumns[tagKey]
  const hiddenColumns = useMemo(() => new Set(columnsSetting?.hidden ?? []), [columnsSetting])
  const columnWidths = columnsSetting?.widths ?? EMPTY_WIDTHS
  const visibleTagType = useMemo(
    () =>
      collectionAvailable
        ? { properties: tagType.properties.filter((entry) => !hiddenColumns.has(entry.key)) }
        : null,
    [collectionAvailable, tagType, hiddenColumns],
  )
  const setColumnWidth = useCallback(
    (key: string, rem: number) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => {
        const entry = current.collectionColumns[tagKey] ?? { hidden: [], widths: {} }
        return {
          collectionColumns: {
            ...current.collectionColumns,
            [tagKey]: { ...entry, widths: { ...entry.widths, [key]: rem } },
          },
        }
      })
    },
    [tagKey, updateSettingsWith],
  )
  const toggleColumnHidden = useCallback(
    (key: string) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => {
        const entry = current.collectionColumns[tagKey] ?? { hidden: [], widths: {} }
        const hidden = entry.hidden.includes(key)
          ? entry.hidden.filter((hiddenKey) => hiddenKey !== key)
          : [...entry.hidden, key]
        return {
          collectionColumns: { ...current.collectionColumns, [tagKey]: { ...entry, hidden } },
        }
      })
    },
    [tagKey, updateSettingsWith],
  )
  return {
    boardProperties,
    boardGroupProperty,
    boardAvailable,
    calendarDateProperty,
    calendarAvailable,
    view,
    setViewMode,
    collectionView,
    collectionSorts,
    setCollectionSorts,
    setCollectionGroup,
    tableGroupProperty,
    tableGroupProperties,
    setTableGroup,
    hiddenColumns,
    columnWidths,
    visibleTagType,
    setColumnWidth,
    toggleColumnHidden,
  }
}

/** The live view state a saved view snapshots (and restores on apply). */
export interface CollectionSavedViewsOptions {
  tagKey: string | null
  view: AllNotesView
  collectionSorts: readonly CollectionSort[]
  boardGroupProperty: TagProperty | null
  tableGroupProperty: TagProperty | null
  collectionFilters: CollectionFilter[]
  filterMatch: CollectionFilterMatch
  setViewMode: (mode: AllNotesView) => void
  setCollectionSorts: (sorts: readonly CollectionSort[]) => void
  setCollectionGroup: (key: string) => void
  setTableGroup: (key: string | null) => void
  setCollectionFilters: (filters: CollectionFilter[]) => void
  setFilterMatch: (match: CollectionFilterMatch) => void
}

/** What `useCollectionSavedViews` hands the CollectionViewsMenu. */
export interface CollectionSavedViews {
  savedViews: SavedCollectionView[]
  saveCurrentView: (name: string) => void
  deleteSavedView: (id: string) => void
  applySavedView: (saved: SavedCollectionView) => void
}

/** Saved views: named bundles of mode + sort + grouping + filters, per tag. */
export function useCollectionSavedViews(
  options: CollectionSavedViewsOptions,
): CollectionSavedViews {
  const {
    tagKey,
    view,
    collectionSorts,
    boardGroupProperty,
    tableGroupProperty,
    collectionFilters,
    filterMatch,
    setViewMode,
    setCollectionSorts,
    setCollectionGroup,
    setTableGroup,
    setCollectionFilters,
    setFilterMatch,
  } = options
  const { settings, updateSettingsWith } = useSettings()
  const savedViews = tagKey === null ? [] : (settings.collectionSavedViews[tagKey] ?? [])
  const saveCurrentView = useCallback(
    (name: string) => {
      if (tagKey === null) {
        return
      }
      const entry: SavedCollectionView = {
        id: crypto.randomUUID(),
        name,
        view: collectionViewForAllNotesView(view),
        sorts: [...collectionSorts],
        group: boardGroupProperty?.key ?? null,
        tableGroup: tableGroupProperty?.key ?? null,
        filters: [...collectionFilters],
        match: filterMatch,
      }
      updateSettingsWith((current) => ({
        collectionSavedViews: {
          ...current.collectionSavedViews,
          [tagKey]: [...(current.collectionSavedViews[tagKey] ?? []), entry],
        },
      }))
    },
    [
      tagKey,
      view,
      collectionSorts,
      boardGroupProperty,
      tableGroupProperty,
      collectionFilters,
      filterMatch,
      updateSettingsWith,
    ],
  )
  const deleteSavedView = useCallback(
    (id: string) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => {
        const remaining = (current.collectionSavedViews[tagKey] ?? []).filter(
          (entry) => entry.id !== id,
        )
        const next = { ...current.collectionSavedViews }
        if (remaining.length === 0) {
          delete next[tagKey]
        } else {
          next[tagKey] = remaining
        }
        return { collectionSavedViews: next }
      })
    },
    [tagKey, updateSettingsWith],
  )
  const applySavedView = useCallback(
    (saved: SavedCollectionView) => {
      setViewMode(saved.view)
      setCollectionSorts(saved.sorts)
      if (saved.group !== null) {
        setCollectionGroup(saved.group)
      }
      // Unlike the board's grouping (which always has one), `null` is a real
      // table state — applying a flat view un-groups.
      setTableGroup(saved.tableGroup)
      setCollectionFilters([...saved.filters])
      setFilterMatch(saved.match)
    },
    [
      setViewMode,
      setCollectionSorts,
      setCollectionGroup,
      setTableGroup,
      setCollectionFilters,
      setFilterMatch,
    ],
  )
  return { savedViews, saveCurrentView, deleteSavedView, applySavedView }
}
