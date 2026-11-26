import type { LooseFile, LooseFileKind } from './loose-files'

/**
 * What a note list can be narrowed to by the kind of file: the notes
 * themselves, or one family of the vault's loose files. `null` (no filter)
 * keeps each list's own mix: notes on the Notes page, notes and their
 * folder's files on a folder page.
 */
export type FileKindFilter = 'notes' | 'pdf' | 'image' | 'html' | 'media' | 'views' | 'other'

/** The choices in the order the menus list them, with their labels. */
export const FILE_KIND_FILTERS: readonly {
  readonly kind: FileKindFilter
  readonly label: string
}[] = [
  { kind: 'notes', label: 'Notes' },
  { kind: 'pdf', label: 'PDFs' },
  { kind: 'image', label: 'Images' },
  { kind: 'html', label: 'HTML pages' },
  { kind: 'media', label: 'Audio and video' },
  { kind: 'views', label: 'Bases and canvases' },
  { kind: 'other', label: 'Other files' },
]

/** The label a chip or menu shows for a choice. */
export function fileKindLabel(kind: FileKindFilter): string {
  return FILE_KIND_FILTERS.find((entry) => entry.kind === kind)!.label
}

/** The loose-file kinds each file filter takes in. */
const KINDS: Readonly<Record<Exclude<FileKindFilter, 'notes'>, readonly LooseFileKind[]>> = {
  pdf: ['pdf'],
  image: ['image'],
  html: ['html'],
  media: ['audio', 'video'],
  views: ['base', 'canvas'],
  other: ['document', 'sheet', 'archive', 'other'],
}

/** Does the list show its notes under `kind`? */
export function fileKindShowsNotes(kind: FileKindFilter | null): boolean {
  return kind === null || kind === 'notes'
}

/** The loose files `kind` keeps: all of them with no filter, none for notes. */
export function filterLooseFilesByKind(
  files: readonly LooseFile[],
  kind: FileKindFilter | null,
): readonly LooseFile[] {
  if (kind === null) {
    return files
  }
  if (kind === 'notes') {
    return []
  }
  const kinds = KINDS[kind]
  return files.filter((file) => kinds.includes(file.kind))
}
