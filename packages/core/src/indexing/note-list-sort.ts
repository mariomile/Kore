import type { AllNotesSort } from '../settings/schema-collections'
import type { NoteListEntry } from './note-list'

/**
 * Orders an All Notes list by the user's chosen sort. Pinned notes always
 * lead, in whatever order `listNotes` already put them (explicit pin order,
 * then unordered pins) — the sort only reorders the unpinned tail. Title
 * comparisons are case-insensitive (`sensitivity: 'base'`); any tie, on
 * either sort kind, breaks by path for a stable, deterministic order.
 */
export function sortNoteList<T extends NoteListEntry>(
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
        return (
          a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) ||
          a.path.localeCompare(b.path)
        )
      }
      case 'title-desc': {
        return (
          b.title.localeCompare(a.title, undefined, { sensitivity: 'base' }) ||
          a.path.localeCompare(b.path)
        )
      }
    }
  }

  return [...pinned, ...rest.sort(compare)]
}
