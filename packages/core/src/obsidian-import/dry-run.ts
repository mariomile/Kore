import { errorMessage } from '../errors'
import { listAttachments, listFiles, readNoteLocal, readObsidianConfig } from '../graph/commands'
import { vaultLayoutFromObsidian, type VaultLayout } from '../graph/vault-layout'
import { splitFrontmatter } from '../markdown/frontmatter'
import { buildVaultCompatReport, type VaultCompatReport } from '../vault-compat/scan'
import { detectCompatFindings } from '../vault-compat/detect'
import type { ScannedNote } from '../vault-compat/scan'
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

/** What converting an Obsidian vault to Kore's layout would do, without doing it. */
export interface ObsidianImportReport {
  /** The layout the vault declares, which the conversion moves away from. */
  readonly layout: VaultLayout
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
  /** Plugin syntax Kore doesn't render, carried over as written. */
  readonly compat: VaultCompatReport
}

/** Build the report from what the vault holds (pure; {@link dryRunObsidianImport} feeds it). */
export function buildObsidianImportReport(input: {
  readonly layout: VaultLayout
  readonly notes: readonly ImportSourceNote[]
  readonly attachments: readonly string[]
  readonly skipped: number
  readonly classify: (body: string) => ImportFidelity
}): ObsidianImportReport {
  const plan = planImportMoves(input.layout, [
    ...input.notes.map((note) => note.path),
    ...input.attachments,
  ])
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
  for (const note of input.notes) {
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
    layout: input.layout,
    moves,
    conflicts: plan.conflicts,
    rewrittenNotes,
    rewrittenLinks,
    normalizing,
    lossy: lossy.sort(),
    compat: buildVaultCompatReport(scanned, {
      scanned: input.notes.length,
      skipped: input.skipped,
    }),
  }
}

/** How many note reads run at once, as the compatibility scan does. */
const READ_CONCURRENCY = 8

/**
 * Dry-run converting the open vault from its Obsidian layout to Kore's: read
 * every note, plan the moves, rewrite links in memory and classify each
 * result. Writes nothing. `null` when the vault carries no Obsidian settings,
 * so there is nothing to convert. Notes evicted to iCloud or failing to read
 * are counted as skipped. Pinned to `generation`.
 */
export async function dryRunObsidianImport(
  generation: number,
  classify: (body: string) => ImportFidelity,
): Promise<ObsidianImportReport | null> {
  const layout = vaultLayoutFromObsidian(await readObsidianConfig(generation))
  if (!layout.obsidian) {
    return null
  }
  const [files, attachments] = await Promise.all([
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
  return buildObsidianImportReport({
    layout,
    notes,
    attachments: attachments.map((file) => file.path),
    skipped,
    classify,
  })
}
