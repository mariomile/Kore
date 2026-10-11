import { slugForTitle, titleFileStem } from '../markdown/slug'
import { getVaultLayout, parseDailyFormat, type VaultLayout } from './vault-layout'

/**
 * Pure helpers for the graph's on-disk path conventions (Plan 02). These build
 * and recognize **graph-relative** paths; the Rust layer owns the root and the
 * traversal guard. Shared by every later phase (daily notes, backlinks, CLI).
 * Daily-note paths follow the open graph's {@link VaultLayout} (Kore's
 * `daily/YYYY-MM-DD.md` unless an Obsidian vault declares its own).
 */

/** Kore's own daily-note folder (the default layout's). */
export const DAILY_DIR = 'daily'
export const NOTES_DIR = 'notes'
/** Note templates — indexed as their own kind, excluded from note surfaces. */
export const TEMPLATES_DIR = 'templates'
/**
 * Tag definition notes (TDR 0005) — `tags/<name>.md` with a `lore: tag`
 * marker defines the tag's type. Indexed as their own kind, linkable and
 * openable like notes, excluded from note-listing surfaces.
 */
export const TAGS_DIR = 'tags'
export const ASSETS_DIR = 'assets'
/** Audio-memo recordings live apart from pasted/dropped `assets/` files. */
export const AUDIO_MEMOS_DIR = 'audio-memos'

/** Root trees whose Markdown files are attachment metadata, never notes. */
const RESERVED_NOTE_TREES = new Set([ASSETS_DIR, AUDIO_MEMOS_DIR])

/**
 * Local attachment formats Reflect can render or open: Obsidian-compatible
 * media plus common document, text, data, and archive formats. Never
 * executable or script formats. Must stay identical to the Rust list in
 * `crates/graph-paths/src/lib.rs` and the fixture generator in
 * `fixtures/gen-path-classification.mjs`.
 */
const ATTACHMENT_EXTENSIONS = new Set([
  '3gp',
  '7z',
  'avif',
  'base',
  'bmp',
  'canvas',
  'csv',
  'doc',
  'docx',
  'epub',
  'flac',
  'gif',
  'gz',
  'heic',
  'ics',
  'jpeg',
  'jpg',
  'json',
  'key',
  'log',
  'm4a',
  'mkv',
  'mov',
  'mp3',
  'mp4',
  'numbers',
  'odp',
  'ods',
  'odt',
  'ogg',
  'ogv',
  'pages',
  'pdf',
  'png',
  'ppt',
  'pptx',
  'rtf',
  'svg',
  'tar',
  'tif',
  'tiff',
  'tsv',
  'txt',
  'wav',
  'webm',
  'webp',
  'xls',
  'xlsx',
  'xml',
  'yaml',
  'yml',
  'zip',
])

/** A supported content kind at a safe, visible graph-relative path. */
export type GraphPathKind = 'note' | 'attachment'

/**
 * ASCII-only lowering, byte-for-byte the Rust side's `eq_ignore_ascii_case`.
 * Full-Unicode `toLowerCase` folds characters Rust does not (KELVIN SIGN → k),
 * and the two classifiers must never disagree on the same wire path.
 */
function asciiLowerCase(value: string): string {
  return value.replaceAll(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32))
}

/** A bare ISO date (`YYYY-MM-DD`). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Is this a real calendar date, not merely a `YYYY-MM-DD`-shaped string?
 * `daily/2026-02-31.md` is a legal filename and an ordinary note; it must
 * never claim a date that no calendar has. Rejects well-formatted but invalid
 * dates (e.g. 2026-13-99) by round-tripping through UTC and comparing the
 * components.
 */
export function isCalendarDate(date: string): boolean {
  if (!ISO_DATE_RE.test(date)) {
    return false
  }
  // The regex guarantees three numeric parts, so the destructure can't yield
  // undefined. `setUTCFullYear` rather than `Date.UTC`: the latter remaps
  // years 0-99 to 1900-1999, which would reject real dates like 0099-12-31.
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const utc = new Date(0)
  utc.setUTCFullYear(year, month - 1, day)
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  )
}

/** A layout's daily-path codec, compiled once per layout. */
interface DailyCodec {
  readonly format: (year: string, month: string, day: string) => string
  readonly pattern: RegExp
  /** Capture-group order of the date fields in {@link pattern}. */
  readonly fields: readonly ('year' | 'month' | 'day')[]
}

let codecCache: { layout: VaultLayout; codec: DailyCodec } | null = null

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\/]/g, String.raw`\$&`)
}

function dailyCodec(): DailyCodec {
  const layout = getVaultLayout()
  if (codecCache?.layout === layout) {
    return codecCache.codec
  }
  // `vaultLayoutFromObsidian` only installs formats that parse; the ISO
  // fallback covers a hand-built layout that slipped one through.
  const parts = parseDailyFormat(layout.dailyFormat) ?? parseDailyFormat('YYYY-MM-DD') ?? []
  const prefix = layout.dailyFolder === '' ? '' : `${layout.dailyFolder}/`
  const fields: ('year' | 'month' | 'day')[] = []
  let source = `^${escapeRegExp(prefix)}`
  for (const part of parts) {
    if (part.kind === 'literal') {
      source += escapeRegExp(part.text)
    } else {
      fields.push(part.kind)
      source +=
        part.kind === 'year'
          ? String.raw`(\d{4})`
          : part.padded
            ? String.raw`(\d{2})`
            : String.raw`(\d{1,2})`
    }
  }
  source += String.raw`\.md$`
  const codec: DailyCodec = {
    pattern: new RegExp(source),
    fields,
    format: (year, month, day) => {
      const body = parts
        .map((part) => {
          switch (part.kind) {
            case 'literal':
              return part.text
            case 'year':
              return year
            case 'month':
              return part.padded ? month : String(Number(month))
            case 'day':
              return part.padded ? day : String(Number(day))
          }
        })
        .join('')
      return `${prefix}${body}.md`
    },
  }
  codecCache = { layout, codec }
  return codec
}

/** Graph-relative path to a daily note for an ISO `YYYY-MM-DD` date. */
export function dailyPath(date: string): string {
  if (!ISO_DATE_RE.test(date)) {
    throw new Error(`dailyPath expects an ISO YYYY-MM-DD date, got: ${date}`)
  }
  if (!isCalendarDate(date)) {
    throw new Error(`dailyPath expects a valid calendar date, got: ${date}`)
  }
  const [year, month, day] = date.split('-') as [string, string, string]
  return dailyCodec().format(year, month, day)
}

/**
 * A daily path pattern for prompts and docs, e.g. `daily/YYYY-MM-DD.md` or
 * `Journal/Daily/DD-MM-YYYY.md`.
 */
export function dailyPathPattern(): string {
  const layout = getVaultLayout()
  const prefix = layout.dailyFolder === '' ? '' : `${layout.dailyFolder}/`
  return `${prefix}${layout.dailyFormat.replaceAll(/\[([^\]]*)\]/g, '$1')}.md`
}

/**
 * Fold a graph-relative path for case-insensitive comparison. NFC first
 * (macOS hands back NFD for some filenames), then the same ASCII-only
 * lowering {@link classifyGraphPath} uses.
 *
 * Deliberately not `foldKey`: every comparand of a path key passes through
 * this one fold, and keeping the lowering ASCII-only means it can never
 * disagree about case with the Rust walker's `eq_ignore_ascii_case` view of
 * the same filenames. (NFC's own singleton mappings, e.g. KELVIN SIGN to K,
 * are fine: they apply to both sides of every comparison.)
 */
export function foldGraphPath(path: string): string {
  return asciiLowerCase(path.normalize('NFC'))
}

/**
 * Graph-relative path to a new regular note for a filename stem (without
 * `.md`): `notes/<stem>.md` in Kore's layout, or the folder an adopted
 * vault creates notes in.
 */
export function notePath(stem: string): string {
  return `${newNoteFolderPrefix()}${stem}.md`
}

/** The new-note folder with its trailing slash (`notes/`), or `''` for the vault root. */
export function newNoteFolderPrefix(): string {
  const folder = getVaultLayout().newNoteFolder
  return folder === '' ? '' : `${folder}/`
}

/**
 * The filename stem a note titled `title` gets: Kore's slug
 * (`meeting-notes`) or, in a vault that names files after titles, the
 * title itself (`Meeting Notes`).
 */
export function noteFileStemForTitle(title: string): string {
  return getVaultLayout().noteFileNames === 'title' ? titleFileStem(title) : slugForTitle(title)
}

/**
 * The `ordinal`-th spelling in a filename stem's collision family: the stem
 * itself, then `stem-2`, `stem-3`, … for slugs, or `Stem 2`, `Stem 3`, …
 * for title filenames (Obsidian's own suffix shape).
 */
export function collisionStem(stem: string, ordinal: number): string {
  if (ordinal === 1) {
    return stem
  }
  return getVaultLayout().noteFileNames === 'title' ? `${stem} ${ordinal}` : `${stem}-${ordinal}`
}

/** Is `candidate` the `stem` collision family's member (`stem`, `stem-2`, …)? */
export function isCollisionStemOf(candidate: string, stem: string): boolean {
  if (candidate === stem) {
    return true
  }
  const separator = getVaultLayout().noteFileNames === 'title' ? ' ' : '-'
  return (
    candidate.startsWith(`${stem}${separator}`) &&
    /^\d+$/.test(candidate.slice(stem.length + separator.length))
  )
}

/** Graph-relative path to a template for a filename slug (without `.md`). */
export function templatePath(slug: string): string {
  return `${TEMPLATES_DIR}/${slug}.md`
}

/** Graph-relative path to an attachment under `assets/`. */
export function assetPath(name: string): string {
  return `${ASSETS_DIR}/${name}`
}

/** Graph-relative path to a stored recording under `audio-memos/`. */
export function audioMemoPath(name: string): string {
  return `${AUDIO_MEMOS_DIR}/${name}`
}

/**
 * Suffix of a managed asset-description file (Plan 20): the AI description +
 * OCR for an asset lives beside it as `<asset>.reflect.md`.
 */
export const DESCRIPTION_SUFFIX = '.reflect.md'

/** Graph-relative description path for an asset (`assets/x.png` → `assets/x.png.reflect.md`). */
export function descriptionPathFor(assetPath: string): string {
  return `${assetPath}${DESCRIPTION_SUFFIX}`
}

/**
 * Is this graph-relative path an asset under `assets/` (and not a managed
 * description file)? A coarse predicate — it does not check the file
 * extension — used to decide whether a watcher batch is relevant to the
 * asset-description pass; precise eligibility is `isEligibleAssetPath`.
 */
export function isAssetPath(path: string): boolean {
  return path.startsWith(`${ASSETS_DIR}/`) && !path.endsWith(DESCRIPTION_SUFFIX)
}

/**
 * Is this graph-relative path a daily note in the open graph's layout
 * (`daily/YYYY-MM-DD.md` by default)?
 */
export function isDaily(path: string): boolean {
  return dateFromDailyPath(path) !== null
}

/**
 * Whether every component is a visible, normal graph-relative component.
 * Filesystem walkers must additionally reject symlinks because a lexical path
 * cannot reveal what an entry points at.
 */
export function isSafeVisibleGraphPath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || /^[A-Z]:/i.test(path)) {
    return false
  }
  const components = path.split('/')
  return components.every((component) => component !== '' && !component.startsWith('.'))
}

/**
 * Classify a graph-relative wire path using the cross-platform discovery
 * policy (mirrored by `crates/graph-paths` and pinned by the shared fixture
 * corpus). Notes require an exactly lowercase `.md` suffix. Attachments match
 * their extension case-insensitively. Hidden, absolute, and traversal paths
 * fail closed, while Markdown may otherwise live at the root or any depth.
 */
export function classifyGraphPath(path: string): GraphPathKind | null {
  if (!isSafeVisibleGraphPath(path)) {
    return null
  }
  const components = path.split('/')
  const first = components[0]
  const filename = components.at(-1)
  if (first === undefined || filename === undefined) {
    return null
  }
  const extensionSeparator = filename.lastIndexOf('.')
  if (extensionSeparator < 0 || extensionSeparator === filename.length - 1) {
    return null
  }
  const extension = filename.slice(extensionSeparator + 1)
  if (extension === 'md' && !RESERVED_NOTE_TREES.has(asciiLowerCase(first))) {
    return 'note'
  }
  return ATTACHMENT_EXTENSIONS.has(asciiLowerCase(extension)) ? 'attachment' : null
}

/**
 * Is this graph-relative path an indexable markdown note? The file-change
 * stream carries more than notes — the watcher also reports `audio-memos/`
 * recordings — so consumers that read or index note *content* gate on this.
 * Templates count: they are indexed and editable like notes, just excluded
 * from note surfaces (gate on {@link isTemplatePath} where that matters,
 * e.g. embeddings).
 */
export function isNotePath(path: string): boolean {
  return classifyGraphPath(path) === 'note'
}

/** Is this graph-relative path a supported local attachment? */
export function isAttachmentPath(path: string): boolean {
  return classifyGraphPath(path) === 'attachment'
}

/**
 * Can an eligible note exist below this graph-relative directory? Walkers use
 * this to prune hidden and reserved root trees before descending.
 */
export function mayContainNotes(path: string): boolean {
  if (!isSafeVisibleGraphPath(path)) {
    return false
  }
  const first = path.split('/')[0]
  return first !== undefined && !RESERVED_NOTE_TREES.has(asciiLowerCase(first))
}

/** Is this graph-relative path a note template (`.md` under `templates/`)? */
export function isTemplatePath(path: string): boolean {
  return path.startsWith(`${TEMPLATES_DIR}/`) && isNotePath(path)
}

/**
 * Extract the ISO date from a daily-note path, or `null` if it isn't one.
 * The date is shape-checked, not calendar-checked (`daily/2026-02-31.md`
 * yields `2026-02-31`; callers gate on {@link isCalendarDate}). A file whose
 * name doesn't spell the date exactly as the layout would (an unpadded day
 * under a padded format, or the reverse) is not a daily.
 */
export function dateFromDailyPath(path: string): string | null {
  const codec = dailyCodec()
  const match = codec.pattern.exec(path)
  if (match === null) {
    return null
  }
  const values: Record<'year' | 'month' | 'day', string> = { year: '', month: '', day: '' }
  for (const [index, field] of codec.fields.entries()) {
    values[field] = (match[index + 1] ?? '').padStart(2, '0')
  }
  if (codec.format(values.year, values.month, values.day) !== path) {
    return null
  }
  return `${values.year}-${values.month}-${values.day}`
}

/**
 * The path's file stem (`notes/reading-list.md` → `reading-list`) — the
 * honest display-title fallback while a note's index row is absent, shared
 * by the tab strip and template `{{title}}` so the two can never disagree.
 */
export function noteFileStem(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.md$/i, '')
}
