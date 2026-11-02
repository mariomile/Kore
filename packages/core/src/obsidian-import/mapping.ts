import { DEFAULT_VAULT_LAYOUT, parseDailyFormat, type VaultLayout } from '../graph/vault-layout'

/**
 * Which folder of the source vault plays which of the roles Kore has a
 * convention for. Obsidian lets a vault keep its dailies, attachments and
 * templates anywhere, so the importer proposes a mapping read from
 * `.obsidian/*.json` and the user corrects it before anything moves. `null`
 * means "no folder has this role": its files keep their paths.
 */
export interface ImportMapping {
  /** Graph-relative folder (`''` is the vault root) and moment-style filename format. */
  readonly daily: { readonly folder: string; readonly format: string } | null
  /** Graph-relative folder whose files move into `assets/`. */
  readonly attachments: string | null
  /** Graph-relative folder whose notes move into `templates/`. */
  readonly templates: string | null
  /** Graph-relative folders left out of the conversion entirely. */
  readonly exclude: readonly string[]
}

/** The mapping a vault's own Obsidian settings imply; the starting point the user edits. */
export function importMappingFromLayout(layout: VaultLayout): ImportMapping {
  return {
    daily: { folder: layout.dailyFolder, format: layout.dailyFormat },
    attachments: layout.attachmentFolder,
    // Kore's default `templates` folder is what the layout falls back to when
    // the vault declares none; moving it onto itself is a no-op either way.
    templates: layout.templatesFolder,
    exclude: [],
  }
}

/** Why a daily format can't be used, or `null` when it can. */
export function dailyFormatProblem(format: string): string | null {
  return parseDailyFormat(format) === null
    ? 'Use YYYY, MM (or M) and DD (or D) once each; text in [brackets] is kept as written.'
    : null
}

/** Every folder that holds at least one of `paths`, ancestors included, sorted. */
export function importFolders(paths: readonly string[]): string[] {
  const folders = new Set<string>()
  for (const path of paths) {
    let slash = path.lastIndexOf('/')
    while (slash > 0) {
      const folder = path.slice(0, slash)
      if (folders.has(folder)) {
        break
      }
      folders.add(folder)
      slash = folder.lastIndexOf('/')
    }
  }
  return [...folders].sort()
}

/** Is `path` inside `folder` (`''` is the vault root and holds everything)? */
export function isUnderFolder(path: string, folder: string): boolean {
  return folder === '' || path.startsWith(`${folder}/`)
}

/**
 * The daily side of a mapping as a layout `dateFromDailyPath` understands,
 * or `null` when the mapping has no usable daily role. Built once per plan:
 * the daily codec is cached by layout identity.
 */
export function dailyLayoutOf(mapping: ImportMapping): VaultLayout | null {
  if (mapping.daily === null || parseDailyFormat(mapping.daily.format) === null) {
    return null
  }
  return {
    ...DEFAULT_VAULT_LAYOUT,
    dailyFolder: mapping.daily.folder,
    dailyFormat: mapping.daily.format,
  }
}
