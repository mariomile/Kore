import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import { foldGraphPath, isNotePath, newNoteFolderPrefix } from './paths'

/** A canonical 128-bit ULID (the first character cannot exceed `7`). */
const KORE_NOTE_ID_RE = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/i
/**
 * Case-insensitive on the directory: on a case-insensitive filesystem a
 * pre-existing `Notes/` folder captures Kore's own `notes/…` writes, and
 * the walker then reports the on-disk casing — those notes must not silently
 * lose their management. The second tier (a valid ULID `id`) keeps adopted
 * files under such a folder from being claimed by casing alone. The folder
 * is the open vault's new-note folder (`notes/` unless the vault names one).
 */
function isInNewNoteFolder(path: string): boolean {
  const prefix = foldGraphPath(newNoteFolderPrefix())
  const folded = foldGraphPath(path)
  return folded.startsWith(prefix) && !folded.slice(prefix.length).includes('/')
}

/** Whether a value is a valid Kore note identity. */
export function isValidKoreNoteId(value: unknown): value is string {
  return typeof value === 'string' && KORE_NOTE_ID_RE.test(value)
}

/**
 * Whether a path is eligible for Kore's title-derived filename automation.
 * Managed notes live directly in the new-note folder (`notes/`); nested and adopted vault paths do
 * not become managed merely because their names resemble Kore files.
 */
export function isKoreManagedNotePath(path: string): boolean {
  return isNotePath(path) && isInNewNoteFolder(path)
}

/**
 * Whether an on-disk note is Kore-managed. Both the direct `notes/` path
 * and a valid frontmatter ULID are required. This is filename ownership, not
 * title tracking: adopted and stable-path notes still maintain known links
 * when retitled, but never move files.
 */
export function isKoreManagedNote(path: string, source: string): boolean {
  if (!isKoreManagedNotePath(path)) {
    return false
  }
  const frontmatter = parseFrontmatter(splitFrontmatter(source).raw).data
  return isValidKoreNoteId(frontmatter.id)
}
