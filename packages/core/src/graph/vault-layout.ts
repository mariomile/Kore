import { z } from 'zod'

/**
 * Where an open vault keeps the files Kore has conventions for. Kore's own
 * layout is the default; a vault Obsidian already manages carries its own in
 * `.obsidian/*.json`, and Kore adopts it read-only so the two apps agree on
 * where today's daily note and a pasted image live.
 *
 * Module state on purpose: the daily-path helpers in `paths.ts` are pure,
 * synchronous, and called from everywhere (indexing, routing, capture), and
 * the layout is a per-graph fact fixed at open time — threading it through
 * every caller would buy nothing a graph switch doesn't already reset.
 */
export interface VaultLayout {
  /** Graph-relative daily-note folder (`''` is the vault root). */
  readonly dailyFolder: string
  /** Daily-note filename pattern in moment tokens (`YYYY`, `MM`, `M`, `DD`, `D`). */
  readonly dailyFormat: string
  /**
   * Graph-relative template today's daily starts from. Kore's own
   * `templates/daily.md` loses its frontmatter on the way in; a vault's
   * Obsidian template is copied whole, frontmatter included, as Obsidian does.
   */
  readonly dailyTemplate: string
  /**
   * Graph-relative folder pasted and dropped files land in, and the first
   * place a bare `![[name.png]]` is looked up. `null` keeps Kore's `assets/`.
   */
  readonly attachmentFolder: string | null
  /** Graph-relative folder new notes are created in (`''` is the vault root). */
  readonly newNoteFolder: string
  /**
   * How a new note's filename derives from its title: Kore's lowercase
   * `slug` (`meeting-notes.md`) or the `title` itself (`Meeting Notes.md`),
   * as Obsidian names files.
   */
  readonly noteFileNames: 'slug' | 'title'
}

/** Kore's own layout: `daily/YYYY-MM-DD.md`, `notes/<slug>.md`, attachments under `assets/`. */
export const DEFAULT_VAULT_LAYOUT: VaultLayout = {
  dailyFolder: 'daily',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: 'templates/daily.md',
  attachmentFolder: null,
  newNoteFolder: 'notes',
  noteFileNames: 'slug',
}

let activeLayout: VaultLayout = DEFAULT_VAULT_LAYOUT

/** The layout of the open graph (Kore's default until one is loaded). */
export function getVaultLayout(): VaultLayout {
  return activeLayout
}

/** Install the open graph's layout. Call before anything indexes or routes. */
export function setVaultLayout(layout: VaultLayout): void {
  activeLayout = layout
}

/**
 * A stable fingerprint of everything in the layout that changes what the
 * index derives from a path (which files are dailies, and their dates).
 * Empty for Kore's default, so existing indexes stay current.
 */
export function vaultLayoutIndexKey(layout: VaultLayout = activeLayout): string {
  if (
    layout.dailyFolder === DEFAULT_VAULT_LAYOUT.dailyFolder &&
    layout.dailyFormat === DEFAULT_VAULT_LAYOUT.dailyFormat
  ) {
    return ''
  }
  return `daily=${layout.dailyFolder}/${layout.dailyFormat}`
}

/** One piece of a parsed daily format: a date field or literal text. */
type DailyFormatPart =
  | { readonly kind: 'year' }
  | { readonly kind: 'month'; readonly padded: boolean }
  | { readonly kind: 'day'; readonly padded: boolean }
  | { readonly kind: 'literal'; readonly text: string }

const FORMAT_TOKEN_RE = /\[([^\]]*)\]|YYYY|MM|M|DD|D|[A-Za-z]+|[^A-Za-z[]+/g

/**
 * Parse a moment-style daily format into parts, or `null` when it uses a
 * token Kore can't round-trip (weekday names, two-digit years, week numbers)
 * or omits a date field — such a format can't name exactly one file per day.
 */
export function parseDailyFormat(format: string): readonly DailyFormatPart[] | null {
  const parts: DailyFormatPart[] = []
  for (const match of format.matchAll(FORMAT_TOKEN_RE)) {
    const token = match[0]
    if (match[1] !== undefined) {
      parts.push({ kind: 'literal', text: match[1] })
    } else if (token === 'YYYY') {
      parts.push({ kind: 'year' })
    } else if (token === 'MM' || token === 'M') {
      parts.push({ kind: 'month', padded: token === 'MM' })
    } else if (token === 'DD' || token === 'D') {
      parts.push({ kind: 'day', padded: token === 'DD' })
    } else if (/^[a-z]/i.test(token)) {
      return null
    } else {
      parts.push({ kind: 'literal', text: token })
    }
  }
  const count = (kind: DailyFormatPart['kind']): number =>
    parts.filter((part) => part.kind === kind).length
  if (count('year') !== 1 || count('month') !== 1 || count('day') !== 1) {
    return null
  }
  return parts
}

/** Normalize a vault-relative folder: trims slashes; `null` when it is unsafe. */
function normalizeFolder(folder: string): string | null {
  const trimmed = folder.trim().replaceAll(/^\/+|\/+$/g, '')
  if (trimmed === '') {
    return ''
  }
  if (trimmed.includes('\\')) {
    return null
  }
  const safe = trimmed
    .split('/')
    .every((segment) => segment !== '' && segment !== '..' && !segment.startsWith('.'))
  return safe ? trimmed : null
}

/**
 * The format's literals can spell path segments too (`[../]YYYY`): the
 * formatted path must stay as safe as the folder. Digits never add a
 * segment, so one sample date checks every date.
 */
function isSafeDailyPath(folder: string, parts: readonly DailyFormatPart[]): boolean {
  const name = parts
    .map((part) => (part.kind === 'literal' ? part.text : part.kind === 'year' ? '2024' : '1'))
    .join('')
  const sample = folder === '' ? name : `${folder}/${name}`
  return normalizeFolder(sample) === sample
}

/** `.obsidian/daily-notes.json` — Obsidian omits keys left at their defaults. */
const obsidianDailyNotesSchema = z.object({
  folder: z.string().optional(),
  format: z.string().optional(),
  template: z.string().optional(),
})

/** The `.obsidian/app.json` keys Kore reads. */
const obsidianAppSchema = z.object({
  attachmentFolderPath: z.string().optional(),
  newFileLocation: z.string().optional(),
  newFileFolderPath: z.string().optional(),
})

/** The raw `.obsidian` files {@link vaultLayoutFromObsidian} reads; `null` when absent. */
export interface ObsidianConfigFiles {
  readonly dailyNotes: string | null
  readonly app: string | null
}

function parseJson<T>(source: string | null, schema: z.ZodType<T>): T | null {
  if (source === null) {
    return null
  }
  try {
    const parsed = schema.safeParse(JSON.parse(source))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * The layout an Obsidian vault declares. Each setting is adopted only when
 * its file is present and the value is usable, so a vault without
 * `.obsidian/` (or with a malformed file) keeps Kore's own layout:
 *
 * - `daily-notes.json` → daily folder, filename format and template, with
 *   Obsidian's own defaults (vault root, `YYYY-MM-DD`) for the keys it omits;
 * - `app.json` `attachmentFolderPath` → the attachment folder, when it names
 *   a fixed folder (`./`-relative "next to the note" settings and the vault
 *   root keep `assets/`);
 * - `app.json` itself → new notes are named after their title, as Obsidian
 *   names them, and land in `newFileFolderPath` when `newFileLocation` is
 *   `folder` (the vault root for `root`; Obsidian's "same folder as the
 *   current file" has no fixed answer, so it keeps `notes/`).
 */
export function vaultLayoutFromObsidian(files: ObsidianConfigFiles): VaultLayout {
  let layout = DEFAULT_VAULT_LAYOUT
  const daily = parseJson(files.dailyNotes, obsidianDailyNotesSchema)
  if (daily !== null) {
    const folder = normalizeFolder(daily.folder ?? '')
    const format = (daily.format ?? '').trim() || 'YYYY-MM-DD'
    const parts = parseDailyFormat(format)
    if (folder !== null && parts !== null && isSafeDailyPath(folder, parts)) {
      layout = { ...layout, dailyFolder: folder, dailyFormat: format }
    }
    const template = normalizeFolder(daily.template ?? '')
    if (template !== null && template !== '') {
      layout = {
        ...layout,
        dailyTemplate: template.endsWith('.md') ? template : `${template}.md`,
      }
    }
  }
  const app = parseJson(files.app, obsidianAppSchema)
  if (app !== null) {
    layout = { ...layout, noteFileNames: 'title' }
    const newFolder =
      app.newFileLocation === 'root'
        ? ''
        : app.newFileLocation === 'folder'
          ? normalizeFolder(app.newFileFolderPath ?? '')
          : null
    if (newFolder !== null) {
      layout = { ...layout, newNoteFolder: newFolder }
    }
  }
  const attachments = app?.attachmentFolderPath?.trim() ?? ''
  if (attachments !== '' && !attachments.startsWith('./') && attachments !== '.') {
    const folder = normalizeFolder(attachments)
    if (folder !== null && folder !== '') {
      layout = { ...layout, attachmentFolder: folder }
    }
  }
  return layout
}
