import {
  DEFAULT_VAULT_LAYOUT,
  setVaultLayout,
  type VaultLayout,
} from '@reflect/core/graph/vault-layout'

/**
 * The vault's layout (daily-note folder and format, new-note folder, file
 * naming), handed to the Worker by setup as the `KORE_VAULT_LAYOUT` JSON
 * variable: the same `VaultLayout` the app reads from `.obsidian/`, so a
 * daily note or a new note lands where the app would put it. Unknown or
 * mistyped fields fall back to Kore's default layout.
 */
export function parseVaultLayout(json: string | undefined): VaultLayout {
  if (json === undefined || json.trim() === '') {
    return DEFAULT_VAULT_LAYOUT
  }
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    console.error('layout: KORE_VAULT_LAYOUT is not JSON; using the default layout')
    return DEFAULT_VAULT_LAYOUT
  }
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_VAULT_LAYOUT
  }
  const given = value as Record<string, unknown>
  const text = (key: keyof VaultLayout): string | undefined =>
    typeof given[key] === 'string' ? given[key] : undefined
  const fallback = DEFAULT_VAULT_LAYOUT
  return {
    dailyFolder: text('dailyFolder') ?? fallback.dailyFolder,
    dailyFormat: text('dailyFormat') ?? fallback.dailyFormat,
    dailyTemplate: text('dailyTemplate') ?? fallback.dailyTemplate,
    attachmentFolder:
      given.attachmentFolder === null
        ? null
        : (text('attachmentFolder') ?? fallback.attachmentFolder),
    newNoteFolder: text('newNoteFolder') ?? fallback.newNoteFolder,
    noteFileNames: given.noteFileNames === 'title' ? 'title' : 'slug',
    templatesFolder: text('templatesFolder') ?? fallback.templatesFolder,
    templateDateFormat: text('templateDateFormat') ?? null,
    templateTimeFormat: text('templateTimeFormat') ?? null,
    obsidian: given.obsidian === true,
  }
}

let installed: string | undefined | null = null

/** Install the layout for this isolate; cheap after the first call per value. */
export function installVaultLayout(json: string | undefined): void {
  if (installed === json) {
    return
  }
  setVaultLayout(parseVaultLayout(json))
  installed = json
}
