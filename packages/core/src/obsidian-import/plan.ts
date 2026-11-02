import { foldKey } from '../markdown/keys'
import {
  ASSETS_DIR,
  DAILY_DIR,
  TEMPLATES_DIR,
  dateFromDailyPath,
  foldGraphPath,
  isAttachmentPath,
  isCalendarDate,
  isNotePath,
} from '../graph/paths'
import type { VaultLayout } from '../graph/vault-layout'

/**
 * Where one file of an Obsidian vault goes when the vault is converted to
 * Kore's own layout. Only the three trees Kore has conventions for move:
 * daily notes, the attachment folder and the templates folder. Every other
 * note keeps its path, folders included: Kore reads notes anywhere.
 */
export type ImportMoveKind = 'daily' | 'attachment' | 'template'

export interface ImportMove {
  readonly from: string
  readonly to: string
  readonly kind: ImportMoveKind
}

/** A move that can't happen because its destination is taken; the file stays put. */
export interface ImportConflict extends ImportMove {
  /** `occupied`: a file that isn't moving already has the path. `duplicate`: an earlier move claimed it. */
  readonly reason: 'occupied' | 'duplicate'
}

export interface ImportMovePlan {
  /** Sorted by source path. */
  readonly moves: readonly ImportMove[]
  /** Sorted by source path. */
  readonly conflicts: readonly ImportConflict[]
}

function underFolder(path: string, folder: string): string | null {
  return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : null
}

function destinationOf(layout: VaultLayout, path: string): ImportMove | null {
  if (isNotePath(path)) {
    const date = dateFromDailyPath(path, layout)
    if (date !== null && isCalendarDate(date)) {
      return { from: path, to: `${DAILY_DIR}/${date}.md`, kind: 'daily' }
    }
    const template = underFolder(path, layout.templatesFolder)
    if (template !== null) {
      return { from: path, to: `${TEMPLATES_DIR}/${template}`, kind: 'template' }
    }
    return null
  }
  if (isAttachmentPath(path) && layout.attachmentFolder !== null) {
    const attachment = underFolder(path, layout.attachmentFolder)
    if (attachment !== null) {
      return { from: path, to: `${ASSETS_DIR}/${attachment}`, kind: 'attachment' }
    }
  }
  return null
}

/**
 * Plan the moves that turn a vault laid out as `layout` declares into Kore's
 * layout: dailies to `daily/YYYY-MM-DD.md`, the attachment folder's files
 * into `assets/`, the templates folder into `templates/`, each keeping its
 * path below the folder. Pure; `paths` is every note and attachment the vault
 * lists. A move whose destination (compared case-folded, as APFS does) is held
 * by a file that stays, or by an earlier move, becomes a conflict and its file
 * stays where it is.
 */
export function planImportMoves(layout: VaultLayout, paths: readonly string[]): ImportMovePlan {
  const candidates: ImportMove[] = []
  const staying = new Set<string>()
  for (const path of [...paths].sort()) {
    const move = destinationOf(layout, path)
    if (move === null || move.to === path) {
      staying.add(foldGraphPath(path))
    } else {
      candidates.push(move)
    }
  }
  const moves: ImportMove[] = []
  const conflicts: ImportConflict[] = []
  const claimed = new Set<string>()
  for (const move of candidates) {
    const key = foldGraphPath(move.to)
    if (staying.has(key)) {
      conflicts.push({ ...move, reason: 'occupied' })
    } else if (claimed.has(key)) {
      conflicts.push({ ...move, reason: 'duplicate' })
    } else {
      claimed.add(key)
      moves.push(move)
    }
  }
  return { moves, conflicts }
}

/** The lookups {@link rewriteImportLinks} needs, built once per plan. */
export interface ImportLinkMap {
  /** Folded source path → its move. */
  readonly byPath: ReadonlyMap<string, ImportMove>
  /** Folded daily file stem (`09-10-2026`) → ISO date, for name links to a daily. */
  readonly dailyByName: ReadonlyMap<string, string>
}

export function importLinkMap(plan: ImportMovePlan): ImportLinkMap {
  const byPath = new Map<string, ImportMove>()
  const dailyByName = new Map<string, string>()
  for (const move of plan.moves) {
    byPath.set(foldGraphPath(move.from), move)
    if (move.kind === 'daily') {
      const stem = move.from.slice(move.from.lastIndexOf('/') + 1, -'.md'.length)
      dailyByName.set(foldKey(stem), move.to.slice(DAILY_DIR.length + 1, -'.md'.length))
    }
  }
  return { byPath, dailyByName }
}
