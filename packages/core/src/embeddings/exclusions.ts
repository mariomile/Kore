import { z } from 'zod'
import type { VaultSettings } from '../connectors/vault-settings'

/**
 * Folders a vault keeps out of its semantic index (`semantic.excludeFolders`
 * in the vault's `.kore.json`).
 *
 * Every vector is scanned by every semantic lookup, so a folder of long
 * machine-written notes (meeting transcripts above all) taxes each search and
 * each "Similar notes" panel for content that is rarely what a search by
 * meaning is after. Notes in an excluded folder are not embedded and their
 * stored vectors are dropped; the keyword index is untouched, so they stay
 * findable by their words. A choice about the vault, so it lives in the vault
 * and every device embedding it agrees.
 */

const semanticSettingsSchema = z.looseObject({
  excludeFolders: z.array(z.string()).optional().catch(undefined),
})

/** A folder path as stored and compared: no surrounding slashes or spaces. */
function normalizeFolder(folder: string): string {
  return folder.trim().replaceAll(/^\/+|\/+$/g, '')
}

/** Normalized, non-empty, deduplicated, sorted: the stored form of the list. */
export function normalizeExcludedFolders(folders: readonly string[]): string[] {
  return [...new Set(folders.map(normalizeFolder).filter((folder) => folder !== ''))].sort()
}

/** The vault's excluded folders; a missing or malformed entry is none. */
export function semanticExcludedFolders(vault: VaultSettings): string[] {
  const parsed = semanticSettingsSchema.safeParse(vault['semantic'])
  return parsed.success ? normalizeExcludedFolders(parsed.data.excludeFolders ?? []) : []
}

/** `vault` with its excluded folders replaced, every other key kept. */
export function withSemanticExcludedFolders(
  vault: VaultSettings,
  folders: readonly string[],
): VaultSettings {
  const current = vault['semantic']
  const base = typeof current === 'object' && current !== null ? current : {}
  return { ...vault, semantic: { ...base, excludeFolders: normalizeExcludedFolders(folders) } }
}

/** Whether the note at `path` sits in (or below) one of `folders`. */
export function isInExcludedFolder(path: string, folders: readonly string[]): boolean {
  return folders.some((folder) => path.startsWith(`${folder}/`))
}
