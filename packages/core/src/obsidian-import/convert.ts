import { vaultCopyTree, vaultCopyWrite, type VaultCopyStats } from '../graph/commands'
import { ASSETS_DIR, DAILY_DIR, TEMPLATES_DIR } from '../graph/paths'
import type { ObsidianConfigFiles } from '../graph/vault-layout'
import { splitFrontmatter } from '../markdown/frontmatter'
import type { ImportFidelity, ObsidianImportSource } from './dry-run'
import { dailyLayoutOf, type ImportMapping } from './mapping'
import { importLinkMap, planImportMoves, type ImportMove } from './plan'
import { rewriteImportLinks } from './rewrite'

/**
 * The editor's verdict on a note body and, when it would rewrite it on first
 * save, the Markdown it would write. Injected like the dry run's classifier:
 * Meowdown lives with the editor, not in core.
 */
export type ImportCanonicalizer = (body: string) => {
  readonly fidelity: ImportFidelity
  /** The body as Kore would save it; the body itself unless `normalizing`. */
  readonly canonical: string
}

/** One file of the copy whose contents differ from the source's. */
export interface ConversionWrite {
  /** Path in the copy, after the moves. */
  readonly path: string
  readonly contents: string
}

/** Every byte decision of converting a vault into a copy, before anything is written. */
export interface ObsidianConversion {
  readonly renames: readonly ImportMove[]
  /** Root-relative prefixes left out of the copy: Git history, Kore's index, excluded folders. */
  readonly skip: readonly string[]
  readonly writes: readonly ConversionWrite[]
  /** Notes written in Kore's canonical Markdown. */
  readonly canonical: number
  /** Notes copied without canonicalizing because Kore can't save them losslessly. */
  readonly lossy: number
}

/**
 * Left out of every copy. `.git` is the source's history, which the copy
 * doesn't share; `.kore` is Kore's index of the source, rebuilt on open
 * (`.reflect` is its pre-rename name, in a source Kore hasn't reopened since).
 */
const ALWAYS_SKIPPED = ['.git', '.kore', '.reflect']

const OBSIDIAN_FILES = {
  dailyNotes: '.obsidian/daily-notes.json',
  app: '.obsidian/app.json',
  templates: '.obsidian/templates.json',
} as const

function parseObject(source: string | null | undefined): Record<string, unknown> | null {
  if (source === null || source === undefined) {
    return null
  }
  try {
    const value: unknown = JSON.parse(source)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** `value` with a leading `from` folder replaced by `to`, or `value` itself. */
function movePrefix(value: string, from: string | null, to: string): string {
  if (from === null || from === '') {
    return value
  }
  const trimmed = value.replace(/^\/+/, '')
  if (trimmed === from || trimmed === `${from}/`) {
    return trimmed.endsWith('/') ? `${to}/` : to
  }
  return trimmed.startsWith(`${from}/`) ? `${to}/${trimmed.slice(from.length + 1)}` : value
}

/**
 * The copy's `.obsidian` settings, pointed at the folders the conversion
 * moved files into. Kore reads these to find dailies, attachments and
 * templates until the runtime profile is retired, and Obsidian keeps working
 * on the copy too. A file that doesn't parse is left as it is.
 */
export function convertObsidianSettings(
  config: ObsidianConfigFiles,
  mapping: ImportMapping,
): ConversionWrite[] {
  const writes: ConversionWrite[] = []
  const repoint = (value: string): string =>
    movePrefix(movePrefix(value, mapping.templates, TEMPLATES_DIR), mapping.attachments, ASSETS_DIR)
  const emit = (path: string, before: string, after: Record<string, unknown>): void => {
    const contents = `${JSON.stringify(after, null, 2)}\n`
    if (JSON.stringify(after) !== JSON.stringify(JSON.parse(before))) {
      writes.push({ path, contents })
    }
  }

  const daily = parseObject(config.dailyNotes)
  if (daily !== null && config.dailyNotes) {
    const next = { ...daily }
    if (dailyLayoutOf(mapping) !== null) {
      next.folder = DAILY_DIR
      next.format = 'YYYY-MM-DD'
    }
    if (typeof next.template === 'string') {
      next.template = repoint(next.template)
    }
    emit(OBSIDIAN_FILES.dailyNotes, config.dailyNotes, next)
  }

  const app = parseObject(config.app)
  if (app !== null && config.app) {
    const next = { ...app }
    for (const key of ['attachmentFolderPath', 'newFileFolderPath'] as const) {
      const value = next[key]
      if (typeof value === 'string') {
        next[key] = repoint(value)
      }
    }
    const filters = next.userIgnoreFilters
    if (Array.isArray(filters)) {
      next.userIgnoreFilters = filters.map((filter: unknown) =>
        typeof filter === 'string' ? repoint(filter) : filter,
      )
    }
    emit(OBSIDIAN_FILES.app, config.app, next)
  }

  const templates = parseObject(config.templates)
  if (templates !== null && config.templates && typeof templates.folder === 'string') {
    emit(OBSIDIAN_FILES.templates, config.templates, {
      ...templates,
      folder: repoint(templates.folder),
    })
  }
  return writes
}

/**
 * Decide every byte of converting a vault into a copy laid out the way
 * `mapping` says: which files move, which are left out, and the new contents
 * of each note whose links moved or that Kore would rewrite canonically.
 * Pure. A `lossy` note keeps its text, links aside, so nothing Kore can't
 * represent is lost.
 */
export function buildObsidianConversion(input: {
  readonly mapping: ImportMapping
  readonly source: Pick<ObsidianImportSource, 'notes' | 'attachments' | 'config'>
  readonly convert: ImportCanonicalizer
}): ObsidianConversion {
  const { mapping, source } = input
  const plan = planImportMoves(mapping, [
    ...source.notes.map((note) => note.path),
    ...source.attachments,
  ])
  const excluded = new Set(plan.excluded)
  const map = importLinkMap(plan)
  const destination = new Map(plan.moves.map((move) => [move.from, move.to]))
  const writes: ConversionWrite[] = []
  let canonical = 0
  let lossy = 0
  for (const note of source.notes) {
    if (excluded.has(note.path)) {
      continue
    }
    const rewritten = rewriteImportLinks(note.path, note.content, map).source
    const { body, bodyOffset } = splitFrontmatter(rewritten)
    const verdict = input.convert(body)
    let contents = rewritten
    if (verdict.fidelity === 'normalizing') {
      contents = rewritten.slice(0, bodyOffset) + verdict.canonical
      canonical += 1
    } else if (verdict.fidelity === 'lossy') {
      lossy += 1
    }
    if (contents !== note.content) {
      writes.push({ path: destination.get(note.path) ?? note.path, contents })
    }
  }
  writes.push(...convertObsidianSettings(source.config, mapping))
  return {
    renames: plan.moves,
    skip: [...ALWAYS_SKIPPED, ...mapping.exclude],
    writes,
    canonical,
    lossy,
  }
}

/** How far a conversion has got: files written out of `total`. */
export interface ConversionProgress {
  readonly phase: 'copying' | 'writing'
  readonly done: number
  readonly total: number
}

export interface ConversionResult extends VaultCopyStats {
  readonly destination: string
  /** Files the conversion rewrote after copying. */
  readonly written: number
}

/** Rewrites go to Rust in batches, so a large vault never sends one huge IPC message. */
const WRITE_BATCH_BYTES = 2_000_000
const WRITE_BATCH_FILES = 200

/**
 * Convert the vault open at `generation` into the empty folder `destination`:
 * copy every file (moved as planned), then overwrite the notes the conversion
 * rewrote. The open vault is only read; Rust refuses a destination that isn't
 * empty or overlaps it.
 */
export async function convertObsidianVault(input: {
  readonly generation: number
  readonly destination: string
  readonly conversion: ObsidianConversion
  readonly onProgress?: (progress: ConversionProgress) => void
}): Promise<ConversionResult> {
  const { conversion, destination } = input
  const total = conversion.writes.length
  input.onProgress?.({ phase: 'copying', done: 0, total })
  const stats = await vaultCopyTree(
    input.generation,
    destination,
    conversion.renames.map(({ from, to }) => ({ from, to })),
    conversion.skip,
  )
  let done = 0
  let batch: ConversionWrite[] = []
  let bytes = 0
  const flush = async (): Promise<void> => {
    if (batch.length === 0) {
      return
    }
    await vaultCopyWrite(destination, batch)
    done += batch.length
    batch = []
    bytes = 0
    input.onProgress?.({ phase: 'writing', done, total })
  }
  for (const write of conversion.writes) {
    batch.push(write)
    bytes += write.contents.length
    if (bytes >= WRITE_BATCH_BYTES || batch.length >= WRITE_BATCH_FILES) {
      await flush()
    }
  }
  await flush()
  return { ...stats, destination, written: done }
}
