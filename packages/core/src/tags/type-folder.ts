import { TYPE_FOLDER_TITLE_SEGMENT } from './tag-type'

/**
 * Where a type's new notes are born: its `folder:` (see `TagType.folder`).
 * Pure policy, shared by every surface that creates a typed note; the CLI
 * mirrors it in `apps/cli/src/commands/new.rs`. Existing notes never move.
 */

/** The folder part of a type's home, without a trailing `{title}` segment. */
export function typeHomeFolder(folder: string): string {
  return isFolderNoteHome(folder) ? folder.split('/').slice(0, -1).join('/') : folder
}

/** True when the home gives each note its own folder (`…/{title}`). */
export function isFolderNoteHome(folder: string): boolean {
  return folder.split('/').at(-1) === TYPE_FOLDER_TITLE_SEGMENT
}

/**
 * The graph-relative folder a new note titled `stem` (its file stem) of a
 * type with home `folder` is created in: the folder itself, or
 * `<folder>/<stem>` under the folder-note layout.
 */
export function typedNoteFolder(folder: string, stem: string): string {
  return isFolderNoteHome(folder) ? `${typeHomeFolder(folder)}/${stem}` : folder
}
