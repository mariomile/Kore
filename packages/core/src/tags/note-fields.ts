/**
 * Which stored frontmatter keys a note's properties panel leaves out.
 *
 * Kore organizes notes by folder and tags only: the breadcrumb is the folder
 * path, and the `up:` parent link Obsidian vaults carry is not a Kore concept
 * any more (Plan 29 N1; the `up:` breadcrumb was removed for the folder one).
 * A loose `up` stays in the file, untouched, so the vault still opens the same
 * in Obsidian; the panel just doesn't list it. A type whose schema declares
 * the key asked for it on purpose, so a declared field is always shown.
 */
const PANEL_HIDDEN_LOOSE_KEYS: ReadonlySet<string> = new Set(['up'])

/** True when a note-owned (undeclared) key is kept out of the properties panel. */
export function isPanelHiddenLooseKey(key: string): boolean {
  return PANEL_HIDDEN_LOOSE_KEYS.has(key)
}
