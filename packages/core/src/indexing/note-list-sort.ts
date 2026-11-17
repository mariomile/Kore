import type { AllNotesSort } from '../settings/schema-collections'

/** The fields a note list row needs to be sorted — shared by every list shape. */
export interface SortableNoteRow {
  path: string
  title: string
  /** File modification time (epoch ms). */
  mtime: number
  isPinned: boolean
}

/** What an {@link AllNotesSort} orders by, independent of direction. */
export type AllNotesSortField = 'updated' | 'title'

export type AllNotesSortDirection = 'asc' | 'desc'

/** Split a persisted sort into its field and direction (the mobile sheet's two controls). */
export function allNotesSortParts(sort: AllNotesSort): {
  field: AllNotesSortField
  direction: AllNotesSortDirection
} {
  const [field, direction] = sort.split('-') as [AllNotesSortField, AllNotesSortDirection]
  return { field, direction }
}

/** The persisted sort for a field and direction — the inverse of {@link allNotesSortParts}. */
export function allNotesSortFrom(
  field: AllNotesSortField,
  direction: AllNotesSortDirection,
): AllNotesSort {
  return `${field}-${direction}`
}

/**
 * Each field's natural first direction: recency reads newest first, titles
 * read A to Z. Picking a field resets to it, as Finder and Craft do.
 */
export const ALL_NOTES_SORT_DEFAULT_DIRECTION: Record<AllNotesSortField, AllNotesSortDirection> = {
  updated: 'desc',
  title: 'asc',
}

/**
 * One collator for every title comparison: `localeCompare` with options
 * builds a fresh collator per call, which dominates a sort of a few thousand
 * titles. Case- and accent-insensitive (`sensitivity: 'base'`), and numeric so
 * "Note 2" sorts before "Note 10".
 */
const titleCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
})

/**
 * Orders a note list by the user's chosen sort. Pinned notes always lead, in
 * whatever order the caller already put them (explicit pin order, then
 * unordered pins) — the sort only reorders the unpinned tail. Any tie breaks
 * by path for a stable, deterministic order.
 */
export function sortNoteList<T extends SortableNoteRow>(
  notes: readonly T[],
  sort: AllNotesSort,
): T[] {
  const pinned = notes.filter((note) => note.isPinned)
  const rest = notes.filter((note) => !note.isPinned)

  const compare = (a: T, b: T): number => {
    switch (sort) {
      case 'updated-desc': {
        return b.mtime - a.mtime || a.path.localeCompare(b.path)
      }
      case 'updated-asc': {
        return a.mtime - b.mtime || a.path.localeCompare(b.path)
      }
      case 'title-asc': {
        return titleCollator.compare(a.title, b.title) || a.path.localeCompare(b.path)
      }
      case 'title-desc': {
        return titleCollator.compare(b.title, a.title) || a.path.localeCompare(b.path)
      }
    }
  }

  return [...pinned, ...rest.sort(compare)]
}
