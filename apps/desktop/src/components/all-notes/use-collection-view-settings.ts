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
import { groupableProperties } from './collection-board'
import { calendarProperty } from './collection-calendar'
import type { CollectionFilter } from './collection-filter-menu'

/** Stable empty widths map, so an untouched tag never re-keys the memo. */
const EMPTY_WIDTHS: Record<string, number> = {}

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
  collectionSort: CollectionSort | null
  setCollectionSort: (sort: CollectionSort | null) => void
  setCollectionGroup: (key: string) => void
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
 * settings. `tagType` is the routed tag's schema, already narrowed to `null`
 * whenever the Collection views are unavailable (untyped tag, or no tag).
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
  const view =
    (requestedView === 'table' && !collectionAvailable) ||
    (requestedView === 'board' && !boardAvailable) ||
    (requestedView === 'calendar' && !calendarAvailable)
      ? 'list'
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
  // The sort is a persisted per-tag view preference (like task filters):
  // leaving and returning to a collection keeps its order.
  const collectionSort: CollectionSort | null =
    tagKey === null ? null : (settings.collectionSorts[tagKey] ?? null)
  const setCollectionSort = useCallback(
    (sort: CollectionSort | null) => {
      if (tagKey === null) {
        return
      }
      updateSettingsWith((current) => {
        const next = { ...current.collectionSorts }
        if (sort === null) {
          delete next[tagKey]
        } else {
          next[tagKey] = sort
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
    collectionSort,
    setCollectionSort,
    setCollectionGroup,
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
  collectionSort: CollectionSort | null
  boardGroupProperty: TagProperty | null
  collectionFilters: CollectionFilter[]
  setViewMode: (mode: AllNotesView) => void
  setCollectionSort: (sort: CollectionSort | null) => void
  setCollectionGroup: (key: string) => void
  setCollectionFilters: (filters: CollectionFilter[]) => void
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
    collectionSort,
    boardGroupProperty,
    collectionFilters,
    setViewMode,
    setCollectionSort,
    setCollectionGroup,
    setCollectionFilters,
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
        sort: collectionSort,
        group: boardGroupProperty?.key ?? null,
        filters: [...collectionFilters],
      }
      updateSettingsWith((current) => ({
        collectionSavedViews: {
          ...current.collectionSavedViews,
          [tagKey]: [...(current.collectionSavedViews[tagKey] ?? []), entry],
        },
      }))
    },
    [tagKey, view, collectionSort, boardGroupProperty, collectionFilters, updateSettingsWith],
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
      setCollectionSort(saved.sort)
      if (saved.group !== null) {
        setCollectionGroup(saved.group)
      }
      setCollectionFilters([...saved.filters])
    },
    [setViewMode, setCollectionSort, setCollectionGroup, setCollectionFilters],
  )
  return { savedViews, saveCurrentView, deleteSavedView, applySavedView }
}
