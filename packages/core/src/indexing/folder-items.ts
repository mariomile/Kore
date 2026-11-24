import type { AllNotesSort } from '../settings/schema-collections'
import { htmlDisplayName } from '../html/html-file'
import type { LooseFile } from './loose-files'
import { sortNoteList, type SortableNoteRow } from './note-list-sort'

/** One card of a folder page's grid: a note, or a loose file beside it. */
export type FolderItem<T extends SortableNoteRow> =
  | { readonly kind: 'note'; readonly path: string; readonly note: T }
  | { readonly kind: 'file'; readonly path: string; readonly file: LooseFile }

/**
 * The name a loose file is sorted and filtered by: a page's file name without
 * its extension (its `<title>` is read later, by the card), any other file's
 * full name.
 */
export function looseFileTitle(file: LooseFile): string {
  return file.kind === 'html' ? htmlDisplayName(file.path) : file.name
}

/**
 * The loose files whose name holds `needle` (already trimmed and
 * lowercased, as the folder page's title filter keeps it); every file for an
 * empty needle.
 */
export function filterLooseFiles(
  files: readonly LooseFile[],
  needle: string,
): readonly LooseFile[] {
  return needle === ''
    ? files
    : files.filter((file) => file.name.toLocaleLowerCase().includes(needle))
}

/**
 * A folder's notes and loose files as one list, in the page's sort: a file
 * is a document of the folder like any note, so it takes its place by date
 * or name instead of a section of its own. Pinned notes still lead; a file is
 * never pinned. `notes` arrive in that sort already, so their pinned order
 * holds.
 */
export function mergeFolderItems<T extends SortableNoteRow>(
  notes: readonly T[],
  files: readonly LooseFile[],
  sort: AllNotesSort,
): FolderItem<T>[] {
  const noteItems = notes.map((note) => ({
    path: note.path,
    title: note.title,
    mtime: note.mtime,
    isPinned: note.isPinned,
    item: { kind: 'note', path: note.path, note } as const,
  }))
  if (files.length === 0) {
    return noteItems.map((row) => row.item)
  }
  const fileItems = files.map((file) => ({
    path: file.path,
    title: looseFileTitle(file),
    mtime: file.modifiedMs,
    isPinned: false,
    item: { kind: 'file', path: file.path, file } as const,
  }))
  return sortNoteList([...noteItems, ...fileItems], sort).map((row) => row.item)
}
