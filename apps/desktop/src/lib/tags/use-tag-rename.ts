import { forEachConcurrent } from '@kore/utils'
import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  errorMessage,
  listTagOccurrences,
  listTagTypes,
  normalizeTagInput,
  planTagRename,
  relationTargetOf,
  renamedTagName,
  writeNote,
  type TagRename,
  type TagRenamePlan,
} from '@kore/core'
import { moveNoteCarryingSession } from '@/editor/move-note'
import { openSession } from '@/editor/open-documents'
import { readNoteSource } from '@/lib/note-frontmatter'
import { runNoteBatch } from '@/lib/notes/note-batch'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** A rename's preview: the plan plus the notes it must leave alone. */
export interface TagRenamePreview {
  readonly rename: TagRename
  readonly plan: TagRenamePlan
  /** Notes with unsaved edits: never written under the user's cursor. */
  readonly blocked: readonly string[]
}

/** What an apply did, for the sheet's result line. */
export interface TagRenameOutcome {
  readonly changed: number
  readonly failures: readonly string[]
}

export interface TagRenameActions {
  preview: (rename: TagRename) => Promise<TagRenamePreview>
  apply: (preview: TagRenamePreview) => Promise<TagRenameOutcome>
  /** Put back what the last apply did, where nothing changed since. */
  undo: () => Promise<TagRenameOutcome>
  canUndo: boolean
  isBusy: boolean
}

interface UndoLog {
  writes: { path: string; before: string; after: string }[]
  moves: { from: string; to: string }[]
}

/** How many notes are read at once while previewing. */
const READ_CONCURRENCY = 8

/**
 * Rename or merge a tag across the vault, with the same contract as the vault
 * replace: `preview` never writes, `apply` never re-derives. The preview
 * carries each note's bytes, and a note whose bytes moved since is refused
 * rather than rewritten; a note with unsaved edits is never written at all.
 *
 * The notes to read come from the index, not a walk of every file: the
 * `tags` table holds every occurrence of the tag (members and prose
 * mentions, any note kind), and the type definitions that point at it by
 * `extends:` or a relation target are added from `tag_types`. On an
 * 11,000-note vault that is the tag's notes, not 11,000 reads.
 *
 * Order on apply: note rewrites first, then definition moves, so a moved
 * definition already carries its rewritten references. Undo runs the
 * reverse, gated the same way, and every rewritten note is also in the git
 * backup for the per-note history.
 */
export function useTagRename(): TagRenameActions {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const [isBusy, setIsBusy] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const lastRun = useRef<UndoLog | null>(null)

  const preview = useCallback(async (rename: TagRename): Promise<TagRenamePreview> => {
    setIsBusy(true)
    try {
      const from = normalizeTagInput(rename.from)
      const to = normalizeTagInput(rename.to)
      const [occurrences, definitions] = await Promise.all([
        listTagOccurrences([from, to]),
        listTagTypes(),
      ])
      const reaches = (tag: string | undefined): boolean =>
        tag !== undefined && renamedTagName(tag, rename) !== null
      const paths = new Set<string>()
      for (const occurrence of occurrences) {
        if (reaches(occurrence.tag)) {
          paths.add(occurrence.notePath)
        }
      }
      for (const definition of definitions) {
        if (
          reaches(definition.tagKey) ||
          (definition.type.extends ?? []).some(reaches) ||
          definition.type.properties.some((property) => reaches(relationTargetOf(property)))
        ) {
          paths.add(definition.notePath)
        }
      }
      const ordered = [...paths].sort()
      // Slots by index keep the plan in path order whatever order reads finish in.
      const notes = ordered.map((path) => ({ path, source: '' }))
      await forEachConcurrent(notes, READ_CONCURRENCY, async (note) => {
        note.source = await readNoteSource(note.path)
      })
      const plan = planTagRename(rename, {
        notes,
        definitions,
        tags: [...new Set(occurrences.map((occurrence) => occurrence.tag))],
      })
      const blocked = plan.writes
        .filter((write) => openSession(write.path)?.isDirty() === true)
        .map((write) => write.path)
      return { rename, plan, blocked }
    } finally {
      setIsBusy(false)
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (graph !== null) {
      await queryClient.invalidateQueries({
        queryKey: [INDEX_QUERY_SCOPE, graph.root],
      })
    }
  }, [graph, queryClient])

  const apply = useCallback(
    async ({ rename, plan, blocked }: TagRenamePreview): Promise<TagRenameOutcome> => {
      const skip = new Set(blocked)
      const writes = plan.writes.filter((write) => !skip.has(write.path))
      const log: UndoLog = { writes: [], moves: [] }
      const label = `Renaming #${normalizeTagInput(rename.from)}`
      setIsBusy(true)
      try {
        const written = await runNoteBatch({
          label,
          graph,
          queryClient,
          items: writes,
          describe: (write) => write.path,
          each: async (write, generation) => {
            if ((await readNoteSource(write.path)) !== write.before) {
              throw new Error('changed since the preview')
            }
            if (openSession(write.path)?.isDirty() === true) {
              throw new Error('has unsaved changes')
            }
            await writeNote(write.path, write.after, generation)
            log.writes.push(write)
          },
        })
        const moved = await runNoteBatch({
          label,
          graph,
          queryClient,
          items: plan.moves,
          describe: (move) => move.from,
          each: async (move, generation) => {
            await moveNoteCarryingSession(move.from, move.to, generation)
            log.moves.push(move)
          },
        })
        await refresh()
        return {
          changed: log.writes.length,
          failures: [...written.failures, ...moved.failures],
        }
      } catch (cause) {
        return { changed: log.writes.length, failures: [errorMessage(cause)] }
      } finally {
        // Whatever landed stays undoable, even when a later step threw.
        if (log.writes.length > 0 || log.moves.length > 0) {
          lastRun.current = log
          setCanUndo(true)
        }
        setIsBusy(false)
      }
    },
    [graph, queryClient, refresh],
  )

  const undo = useCallback(async (): Promise<TagRenameOutcome> => {
    const log = lastRun.current
    if (log === null) {
      return { changed: 0, failures: [] }
    }
    setIsBusy(true)
    try {
      const movedBack = await runNoteBatch({
        label: 'Undoing rename',
        graph,
        queryClient,
        items: [...log.moves].reverse(),
        describe: (move) => move.to,
        each: async (move, generation) => {
          await moveNoteCarryingSession(move.to, move.from, generation)
        },
      })
      let restored = 0
      const restoredWrites = await runNoteBatch({
        label: 'Undoing rename',
        graph,
        queryClient,
        items: log.writes,
        describe: (write) => write.path,
        each: async (write, generation) => {
          // A note edited since the rename keeps its newer content.
          if ((await readNoteSource(write.path)) !== write.after) {
            throw new Error('edited since the rename')
          }
          await writeNote(write.path, write.before, generation)
          restored += 1
        },
      })
      lastRun.current = null
      setCanUndo(false)
      await refresh()
      return {
        changed: restored,
        failures: [...movedBack.failures, ...restoredWrites.failures],
      }
    } finally {
      setIsBusy(false)
    }
  }, [graph, queryClient, refresh])

  return { preview, apply, undo, canUndo, isBusy }
}
