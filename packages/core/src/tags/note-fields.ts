import { z } from 'zod'
import type { VaultSettings } from '../connectors/vault-settings'

/**
 * Which stored frontmatter keys a note's properties panel keeps out of view.
 *
 * Two sources, one rule:
 *
 * - Kore organizes notes by folder and tags only: the breadcrumb is the
 *   folder path, and the `up:` parent link Obsidian vaults carry is not a
 *   Kore concept (Plan 29 N1; the `up:` breadcrumb was removed for the folder
 *   one). A loose `up` stays in the file, untouched, so the vault still opens
 *   the same in Obsidian; the panel just doesn't list it. A type whose schema
 *   declares the key asked for it on purpose, so a declared `up` is shown.
 * - The person hides any field from every note, Notion's "Hide in page":
 *   bookkeeping their agents write (`created_by`, `updated`) or a schema
 *   field they never read. A choice about the vault, so it lives in the
 *   vault (`properties.hiddenInNote` in `.kore.json`) and every device
 *   agrees. Hidden fields fold behind the panel's "more" toggle, never
 *   vanish, so a hidden field can always be shown again.
 */
const BUILT_IN_HIDDEN_LOOSE_KEYS: ReadonlySet<string> = new Set(['up'])

/** True when a note-owned (undeclared) key is never listed in the panel. */
export function isPanelHiddenLooseKey(key: string): boolean {
  return BUILT_IN_HIDDEN_LOOSE_KEYS.has(key)
}

const propertySettingsSchema = z.looseObject({
  hiddenInNote: z.array(z.string()).optional().catch(undefined),
})

/** Trimmed, non-empty, deduplicated, sorted: the stored form of the list. */
function normalizeKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.map((key) => key.trim()).filter((key) => key !== ''))].sort()
}

/** The keys the person hid from the panel; a missing or malformed entry is none. */
export function hiddenNoteFieldKeys(vault: VaultSettings): string[] {
  const parsed = propertySettingsSchema.safeParse(vault['properties'])
  return parsed.success ? normalizeKeys(parsed.data.hiddenInNote ?? []) : []
}

/** `vault` with `key` hidden (or shown again), every other setting kept. */
export function withNoteFieldHidden(
  vault: VaultSettings,
  key: string,
  hidden: boolean,
): VaultSettings {
  const current = hiddenNoteFieldKeys(vault).filter((entry) => entry !== key)
  const base =
    typeof vault['properties'] === 'object' && vault['properties'] !== null
      ? vault['properties']
      : {}
  return {
    ...vault,
    properties: { ...base, hiddenInNote: normalizeKeys(hidden ? [...current, key] : current) },
  }
}
