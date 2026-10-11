import { errorMessage } from '../errors'
import { listFiles, readNoteLocal } from '../graph/commands'
import { detectCompatFindings, type CompatFinding } from './detect'
import { COMPAT_KINDS, type CompatKindId } from './kinds'

/** One affected note in a report group. */
export interface VaultCompatNote {
  readonly path: string
  /** The file name without `.md`, the title Obsidian shows. */
  readonly title: string
  /** What makes it specific (Mermaid diagram types), empty otherwise. */
  readonly details: readonly string[]
}

/** Every note carrying one unsupported kind. */
export interface VaultCompatGroup {
  readonly kind: CompatKindId
  readonly label: string
  readonly hint: string
  /** Sorted by path. */
  readonly notes: readonly VaultCompatNote[]
}

/** What a vault holds that Kore can't render, grouped by kind. */
export interface VaultCompatReport {
  /** Only kinds with at least one note, in {@link COMPAT_KINDS} order. */
  readonly groups: readonly VaultCompatGroup[]
  /** Distinct notes in any group. */
  readonly affectedNotes: number
  /** Notes read. */
  readonly scanned: number
  /** Notes not read: evicted to iCloud, or failing to read. */
  readonly skipped: number
}

/** One scanned note and what it holds. */
export interface ScannedNote {
  readonly path: string
  readonly findings: readonly CompatFinding[]
}

/** How many note reads run at once: overlaps IPC hops without flooding the bridge. */
const SCAN_CONCURRENCY = 8

function titleOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name
}

/** Group scanned notes into the report (pure; {@link scanVaultCompat} feeds it). */
export function buildVaultCompatReport(
  notes: readonly ScannedNote[],
  counts: { readonly scanned: number; readonly skipped: number },
): VaultCompatReport {
  const byKind = new Map<CompatKindId, VaultCompatNote[]>()
  const affected = new Set<string>()
  for (const note of [...notes].sort((left, right) => left.path.localeCompare(right.path))) {
    const details = new Map<CompatKindId, string[]>()
    for (const finding of note.findings) {
      const list = details.get(finding.kind) ?? []
      if (finding.detail !== null) {
        list.push(finding.detail)
      }
      details.set(finding.kind, list)
    }
    for (const [kind, kindDetails] of details) {
      const group = byKind.get(kind) ?? []
      group.push({ path: note.path, title: titleOf(note.path), details: kindDetails })
      byKind.set(kind, group)
      affected.add(note.path)
    }
  }
  const groups: VaultCompatGroup[] = []
  for (const entry of COMPAT_KINDS) {
    const groupNotes = byKind.get(entry.id)
    if (groupNotes !== undefined) {
      groups.push({ kind: entry.id, label: entry.label, hint: entry.hint, notes: groupNotes })
    }
  }
  return { groups, affectedNotes: affected.size, ...counts }
}

/**
 * Read every note in the open vault and report what Kore can't render (see
 * {@link COMPAT_KINDS}). Read-only. Works from the raw files, not the index:
 * the index keeps plain text, which has already dropped the code-block
 * languages and syntax this looks for. Notes evicted to iCloud are skipped
 * rather than downloaded. Pinned to `generation`, so a graph switch mid-scan
 * fails the reads instead of mixing vaults.
 */
export async function scanVaultCompat(generation: number): Promise<VaultCompatReport> {
  const files = await listFiles(generation)
  const scanned: ScannedNote[] = []
  let skipped = 0
  let read = 0
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
          continue
        }
        read += 1
        const findings = detectCompatFindings(file.path, result.content)
        if (findings.length > 0) {
          scanned.push({ path: file.path, findings })
        }
      } catch (cause) {
        skipped += 1
        console.warn(`vault compat: could not read ${file.path}:`, errorMessage(cause))
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, files.length) }, async () => await worker()),
  )
  return buildVaultCompatReport(scanned, { scanned: read, skipped })
}
