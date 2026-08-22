import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  applyReplaceMatches,
  errorMessage,
  findReplaceMatches,
  listNotes,
  readNote,
  writeNote,
  type ReplaceMatch,
} from '@reflect/core'
import { openSession } from '@/editor/open-documents'
import { startOperation } from '@/lib/operations'
import { useGraph } from '@/providers/graph-provider'
import { allNotesListPrefix } from './all-notes-query'

export interface ReplaceScope {
  needle: string
  replacement: string
  matchCase: boolean
  wholeWord: boolean
}

export interface NoteHits {
  path: string
  title: string
  /** The bytes the preview was computed from — the write is gated on these. */
  source: string
  matches: ReplaceMatch[]
  /** Matches a replace may actually rewrite. */
  live: number
  /** Why this note can't be touched at all, or null. */
  blocked: string | null
}

export interface ScanResult {
  notes: NoteHits[]
  /** Notes with at least one rewritable match. */
  changeable: number
  /** Rewritable matches across the whole vault. */
  liveMatches: number
  /** Matches found but protected (code, links, frontmatter, the title). */
  skippedMatches: number
}

const EMPTY: ScanResult = { notes: [], changeable: 0, liveMatches: 0, skippedMatches: 0 }

/**
 * Read the bytes a replace would act on: the open editor's live buffer when
 * one has the note loaded, otherwise disk — the same order `readNoteSource`
 * uses. Reading disk while a pane holds newer text is how a preview ends up
 * describing a file that no longer exists in that form.
 */
async function currentSource(path: string): Promise<string> {
  return openSession(path)?.liveContent() ?? (await readNote(path))
}

export interface VaultReplace {
  scan: (scope: ReplaceScope) => Promise<ScanResult>
  /** Rewrite the scanned notes. Resolves to how many notes changed. */
  apply: (scope: ReplaceScope, result: ScanResult) => Promise<number>
  /** Put back what the last apply wrote, where nothing has changed since. */
  undo: () => Promise<number>
  canUndo: boolean
  isBusy: boolean
}

interface UndoEntry {
  path: string
  before: string
  after: string
}

/**
 * Vault-wide find and replace.
 *
 * The shape is a hard wall between reading and writing: `scan` never writes,
 * `apply` never re-derives what to change. Everything the user approved is
 * carried in the {@link ScanResult}, including the exact bytes each note held
 * when it was previewed — and a note whose bytes moved between preview and
 * apply is refused rather than rewritten. A preview that can go stale without
 * the write noticing is the failure mode that turns a bulk edit into data
 * loss.
 *
 * Three refusals, each of which lands in the visible blocked list instead of
 * happening quietly:
 *
 * - **A note with unsaved edits.** Writing disk under a dirty buffer parks a
 *   conflict the user never asked for. Same rule the bulk tag action and the
 *   iCloud conflict sweep follow.
 * - **A note that changed since the preview.** The watcher may have reindexed,
 *   another window may have saved, the user may have typed.
 * - **A note whose only matches are protected** — inside code, a link
 *   destination, frontmatter, or the note's own title. Those are counted and
 *   shown, never rewritten.
 *
 * Undo is symmetric and gated the same way: a note that changed after the
 * replace keeps its new content and is reported, rather than being clobbered
 * a second time. Beyond it, every rewritten note is in the git backup, so the
 * per-note history dialog can restore any of them individually.
 */
export function useVaultReplace(): VaultReplace {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const [isBusy, setIsBusy] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const undoable = useRef<UndoEntry[]>([])

  const scan = useCallback(
    async (scope: ReplaceScope): Promise<ScanResult> => {
      if (scope.needle === '' || graph === null) {
        return EMPTY
      }
      setIsBusy(true)
      try {
        // Every note, not an FTS shortlist: the index projects markdown to
        // plain text (frontmatter stripped, links flattened), so it cannot see
        // a needle that lives inside a token or inside syntax. A shortlist
        // that silently misses notes is worse than a slower scan.
        const entries = await listNotes({ tag: null })
        const notes: NoteHits[] = []
        for (const entry of entries) {
          let source: string
          try {
            source = await currentSource(entry.path)
          } catch (cause) {
            notes.push({
              path: entry.path,
              title: entry.title,
              source: '',
              matches: [],
              live: 0,
              blocked: errorMessage(cause),
            })
            continue
          }
          const matches = findReplaceMatches(source, scope)
          if (matches.length === 0) {
            continue
          }
          const live = matches.filter((match) => match.skipped === null).length
          notes.push({
            path: entry.path,
            title: entry.title,
            source,
            matches,
            live,
            blocked: openSession(entry.path)?.isDirty() === true ? 'has unsaved changes' : null,
          })
        }
        return {
          notes,
          changeable: notes.filter((note) => note.live > 0 && note.blocked === null).length,
          liveMatches: notes
            .filter((note) => note.blocked === null)
            .reduce((total, note) => total + note.live, 0),
          skippedMatches: notes.reduce(
            (total, note) => total + note.matches.filter((match) => match.skipped !== null).length,
            0,
          ),
        }
      } finally {
        setIsBusy(false)
      }
    },
    [graph],
  )

  const apply = useCallback(
    async (scope: ReplaceScope, result: ScanResult): Promise<number> => {
      const targets = result.notes.filter((note) => note.live > 0 && note.blocked === null)
      if (targets.length === 0) {
        return 0
      }
      const generation = graph?.generation
      const root = graph?.root
      if (generation === undefined || root === undefined) {
        startOperation('Replacing in vault').fail('No graph is open.')
        return 0
      }
      const operation = startOperation(`Replacing “${scope.needle}”`)
      setIsBusy(true)
      const entries: UndoEntry[] = []
      const failures: string[] = []
      try {
        for (const [index, note] of targets.entries()) {
          operation.progress(index, targets.length)
          try {
            // The gate: only write a note that still holds exactly what the
            // preview described.
            const now = await currentSource(note.path)
            if (now !== note.source) {
              failures.push(`${note.title}: changed since the preview`)
              continue
            }
            if (openSession(note.path)?.isDirty() === true) {
              failures.push(`${note.title}: has unsaved changes`)
              continue
            }
            const after = applyReplaceMatches(note.source, note.matches, scope.replacement)
            if (after === note.source) {
              continue
            }
            await writeNote(note.path, after, generation)
            entries.push({ path: note.path, before: note.source, after })
          } catch (cause) {
            failures.push(`${note.title}: ${errorMessage(cause)}`)
          }
        }
        undoable.current = entries
        setCanUndo(entries.length > 0)
        await queryClient.invalidateQueries({ queryKey: allNotesListPrefix(root) })
        if (failures.length === 0) {
          operation.done()
        } else {
          operation.fail(failures.join('; '))
        }
      } finally {
        setIsBusy(false)
      }
      return entries.length
    },
    [graph, queryClient],
  )

  const undo = useCallback(async (): Promise<number> => {
    const entries = undoable.current
    const generation = graph?.generation
    const root = graph?.root
    if (entries.length === 0 || generation === undefined || root === undefined) {
      return 0
    }
    const operation = startOperation('Undoing replace')
    setIsBusy(true)
    let restored = 0
    const failures: string[] = []
    try {
      for (const [index, entry] of entries.entries()) {
        operation.progress(index, entries.length)
        try {
          // Same gate in reverse: a note edited since the replace keeps its
          // newer content rather than being clobbered a second time.
          const now = await currentSource(entry.path)
          if (now !== entry.after) {
            failures.push(`${entry.path}: edited since the replace`)
            continue
          }
          await writeNote(entry.path, entry.before, generation)
          restored += 1
        } catch (cause) {
          failures.push(`${entry.path}: ${errorMessage(cause)}`)
        }
      }
      undoable.current = []
      setCanUndo(false)
      await queryClient.invalidateQueries({ queryKey: allNotesListPrefix(root) })
      if (failures.length === 0) {
        operation.done()
      } else {
        operation.fail(failures.join('; '))
      }
    } finally {
      setIsBusy(false)
    }
    return restored
  }, [graph, queryClient])

  return { scan, apply, undo, canUndo, isBusy }
}
