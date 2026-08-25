import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  applyReplaceMatches,
  errorMessage,
  findReplaceMatches,
  listNotes,
  writeNote,
  type ReplaceMatch,
} from '@reflect/core'
import { openSession } from '@/editor/open-documents'
import { readNoteSource } from '@/lib/note-frontmatter'
import { runNoteBatch } from './note-batch'
import { useGraph } from '@/providers/graph-provider'

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

/** The no-scan-yet result, shared with the dialog so neither owns a copy. */
export const EMPTY_SCAN: ScanResult = {
  notes: [],
  changeable: 0,
  liveMatches: 0,
  skippedMatches: 0,
}

/** How many notes are read concurrently during a scan. */
const SCAN_CONCURRENCY = 8

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
        return EMPTY_SCAN
      }
      setIsBusy(true)
      try {
        // Every note, not an FTS shortlist: the index projects markdown to
        // plain text (frontmatter stripped, links flattened), so it cannot see
        // a needle that lives inside a token or inside syntax. A shortlist
        // that silently misses notes is worse than a slower scan. The reads
        // are pure, so a small worker pool overlaps the per-note IPC hops —
        // sequentially, a large vault spends seconds purely waiting.
        // (`readNoteSource` prefers the open editor's live buffer over disk,
        // so the preview describes what the user is actually looking at.)
        const entries = await listNotes({ tag: null })
        const slots: (NoteHits | null)[] = entries.map(() => null)
        let nextIndex = 0
        const scanOne = async (index: number): Promise<void> => {
          const entry = entries[index]
          if (entry === undefined) {
            return
          }
          let source: string
          try {
            source = await readNoteSource(entry.path)
          } catch (cause) {
            slots[index] = {
              path: entry.path,
              title: entry.title,
              source: '',
              matches: [],
              live: 0,
              blocked: errorMessage(cause),
            }
            return
          }
          const matches = findReplaceMatches(source, scope)
          if (matches.length === 0) {
            return
          }
          const live = matches.filter((match) => match.skipped === null).length
          slots[index] = {
            path: entry.path,
            title: entry.title,
            source,
            matches,
            live,
            blocked: openSession(entry.path)?.isDirty() === true ? 'has unsaved changes' : null,
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(SCAN_CONCURRENCY, entries.length) }, async () => {
            for (;;) {
              const index = nextIndex
              nextIndex += 1
              if (index >= entries.length) {
                return
              }
              await scanOne(index)
            }
          }),
        )
        // Slots, not pushes: the pool finishes out of order, and the preview
        // must list notes in the index's deterministic order.
        const notes = slots.filter((slot): slot is NoteHits => slot !== null)
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
      setIsBusy(true)
      const entries: UndoEntry[] = []
      try {
        await runNoteBatch({
          label: `Replacing “${scope.needle}”`,
          graph,
          queryClient,
          items: targets,
          describe: (note) => note.title,
          each: async (note, generation) => {
            // The gate: only write a note that still holds exactly what the
            // preview described.
            const now = await readNoteSource(note.path)
            if (now !== note.source) {
              throw new Error('changed since the preview')
            }
            if (openSession(note.path)?.isDirty() === true) {
              throw new Error('has unsaved changes')
            }
            const after = applyReplaceMatches(note.source, note.matches, scope.replacement)
            if (after === note.source) {
              return
            }
            await writeNote(note.path, after, generation)
            entries.push({ path: note.path, before: note.source, after })
          },
        })
        // A run that wrote nothing (e.g. the batch failed fast with no open
        // graph) must not evict the previous replace's undo entries.
        if (entries.length > 0) {
          undoable.current = entries
          setCanUndo(true)
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
    if (entries.length === 0) {
      return 0
    }
    setIsBusy(true)
    let restored = 0
    const restoredPaths = new Set<string>()
    try {
      const result = await runNoteBatch({
        label: 'Undoing replace',
        graph,
        queryClient,
        items: entries,
        describe: (entry) => entry.path,
        each: async (entry, generation) => {
          // Same gate in reverse: a note edited since the replace keeps its
          // newer content rather than being clobbered a second time.
          const now = await readNoteSource(entry.path)
          if (now !== entry.after) {
            throw new Error('edited since the replace')
          }
          await writeNote(entry.path, entry.before, generation)
          restoredPaths.add(entry.path)
          restored += 1
        },
      })
      // Keep the unrestored entries after a failed undo (no open graph,
      // notes that refused) so the user can retry once the blocker clears.
      undoable.current = result.ok ? [] : entries.filter((entry) => !restoredPaths.has(entry.path))
      setCanUndo(undoable.current.length > 0)
    } finally {
      setIsBusy(false)
    }
    return restored
  }, [graph, queryClient])

  return { scan, apply, undo, canUndo, isBusy }
}
