import { errorMessage } from '../errors'
import { listAttachments, listFiles, readNoteLocal, readObsidianConfig } from '../graph/commands'
import { vaultLayoutFromObsidian, type VaultLayout } from '../graph/vault-layout'
import { splitFrontmatter } from '../markdown/frontmatter'
import { buildVaultCompatReport, type VaultCompatReport } from '../vault-compat/scan'
import { detectCompatFindings } from '../vault-compat/detect'
import type { ScannedNote } from '../vault-compat/scan'
import { importFolders, type ImportMapping } from './mapping'
import { importLinkMap, planImportMoves, type ImportConflict, type ImportMoveKind } from './plan'
import { rewriteImportLinks } from './rewrite'

/**
 * How the editor would treat a note body: unchanged on save (`exact`),
 * rewritten in Kore's canonical Markdown on first save (`normalizing`), or
 * opened read-only because saving would lose something (`lossy`). Injected:
 * the classifier is Meowdown's and lives with the editor, not in core.
 */
export type ImportFidelity = 'exact' | 'normalizing' | 'lossy'

/** One note as the dry run read it. */
export interface ImportSourceNote {
  readonly path: string
  readonly content: string
}

/** Everything the dry run reads from the vault, once; reports are built from it per mapping. */
export interface ObsidianImportSource {
  /** The layout the vault's Obsidian settings declare: where the default mapping comes from. */
  readonly layout: VaultLayout
  readonly notes: readonly ImportSourceNote[]
  readonly attachments: readonly string[]
  /** Every folder holding a note or attachment, for picking a mapping. Sorted. */
  readonly folders: readonly string[]
  /** Notes that couldn't be read (evicted to iCloud, or failing). */
  readonly skipped: number
}

/** What converting an Obsidian vault to Kore's layout would do, without doing it. */
export interface ObsidianImportReport {
  /** The mapping the report was built for. */
  readonly mapping: ImportMapping
  readonly moves: Readonly<Record<ImportMoveKind, number>>
  /** Moves that can't happen; those files stay put. */
  readonly conflicts: readonly ImportConflict[]
  /** Notes with at least one link the moves rewrite, and how many links in all. */
  readonly rewrittenNotes: number
  readonly rewrittenLinks: number
  /** Notes Kore would rewrite canonically on conversion. */
  readonly normalizing: number
  /** Notes the conversion would copy untouched because Kore can't save them losslessly. Sorted. */
  readonly lossy: readonly string[]
  /** Files under an excluded folder, left out of the conversion. */
  readonly excluded: number
  /** Plugin syntax Kore doesn't render, carried over as written. */
  readonly compat: VaultCompatReport
}

/**
 * Build the report for one mapping from what the vault holds. Pure and
 * cheap enough to rerun on every mapping edit, provided `classify` is
 * memoized: the round-trip check dominates.
 */
export function buildObsidianImportReport(input: {
  readonly mapping: ImportMapping
  readonly source: Pick<ObsidianImportSource, 'notes' | 'attachments' | 'skipped'>
  readonly classify: (body: string) => ImportFidelity
}): ObsidianImportReport {
  const { source } = input
  const plan = planImportMoves(input.mapping, [
    ...source.notes.map((note) => note.path),
    ...source.attachments,
  ])
  const excluded = new Set(plan.excluded)
  const map = importLinkMap(plan)
  const moves: Record<ImportMoveKind, number> = { daily: 0, attachment: 0, template: 0 }
  for (const move of plan.moves) {
    moves[move.kind] += 1
  }
  let rewrittenNotes = 0
  let rewrittenLinks = 0
  let normalizing = 0
  const lossy: string[] = []
  const scanned: ScannedNote[] = []
  let included = 0
  for (const note of source.notes) {
    if (excluded.has(note.path)) {
      continue
    }
    included += 1
    const rewrite = rewriteImportLinks(note.path, note.content, map)
    if (rewrite.links > 0) {
      rewrittenNotes += 1
      rewrittenLinks += rewrite.links
    }
    const fidelity = input.classify(splitFrontmatter(rewrite.source).body)
    if (fidelity === 'normalizing') {
      normalizing += 1
    } else if (fidelity === 'lossy') {
      lossy.push(note.path)
    }
    const findings = detectCompatFindings(note.path, note.content)
    if (findings.length > 0) {
      scanned.push({ path: note.path, findings })
    }
  }
  return {
    mapping: input.mapping,
    moves,
    conflicts: plan.conflicts,
    rewrittenNotes,
    rewrittenLinks,
    normalizing,
    lossy: lossy.sort(),
    excluded: plan.excluded.length,
    compat: buildVaultCompatReport(scanned, { scanned: included, skipped: source.skipped }),
  }
}

/** How many note reads run at once, as the compatibility scan does. */
const READ_CONCURRENCY = 8

/**
 * Read what a dry run of converting the open vault needs: its Obsidian
 * layout, every note's content and every attachment's path. Writes nothing.
 * `null` when the vault carries no Obsidian settings, so there is nothing to
 * convert. Notes evicted to iCloud or failing to read are counted as skipped.
 * Pinned to `generation`.
 */
export async function readObsidianImportSource(
  generation: number,
): Promise<ObsidianImportSource | null> {
  const layout = vaultLayoutFromObsidian(await readObsidianConfig(generation))
  if (!layout.obsidian) {
    return null
  }
  const [files, attachmentFiles] = await Promise.all([
    listFiles(generation),
    listAttachments(generation),
  ])
  const notes: ImportSourceNote[] = []
  let skipped = 0
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const file = files[next]
      next += 1
      if (file === undefined) {
        return
      }
      if (file.placeholder) {
        skipped += 1
        continue
      }
      try {
        const result = await readNoteLocal(file.path, generation)
        if (result.kind === 'evicted') {
          skipped += 1
        } else {
          notes.push({ path: file.path, content: result.content })
        }
      } catch (cause) {
        skipped += 1
        console.warn(`obsidian import: could not read ${file.path}:`, errorMessage(cause))
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, async () => await worker()),
  )
  const attachments = attachmentFiles.map((file) => file.path)
  return {
    layout,
    notes,
    attachments,
    folders: importFolders([...files.map((file) => file.path), ...attachments]),
    skipped,
  }
}
