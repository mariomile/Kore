import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { appendBodyTag, writeNote } from '@reflect/core'
import { moveNoteCarryingSession } from '@/editor/move-note'
import { openSession } from '@/editor/open-documents'
import { readNoteSource } from '@/lib/note-frontmatter'
import { useGraph } from '@/providers/graph-provider'
import { runNoteBatch } from './note-batch'

export interface BulkOutcome {
  /** Notes the action actually changed. */
  changed: number
  /** Notes that needed no change (already tagged, already in the folder). */
  skipped: number
  /** Notes the action refused to touch, with why — surfaced in the toast. */
  blocked: string[]
  /** True when nothing failed; the caller clears its selection on true. */
  ok: boolean
}

export interface NoteBulkActions {
  /** Append `#tag` to each note that doesn't already carry it. */
  tag: (paths: readonly string[], tag: string) => Promise<BulkOutcome>
  /** Move each note into `folder` ('' is the graph root), keeping its filename. */
  move: (paths: readonly string[], folder: string) => Promise<BulkOutcome>
  isRunning: boolean
}

/** The note's filename, i.e. the path after the last folder separator. */
function basename(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}

/** The note's folder, '' at the graph root. */
export function folderOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

/**
 * Bulk tag and bulk move for an All Notes selection — the two actions that
 * were missing next to bulk trash, which already existed.
 *
 * Three rules the single-note paths established and this keeps:
 *
 * - **A dirty editor buffer is never written over.** Tagging edits prose on
 *   disk, and the open session would see that as an external edit; on a note
 *   with unsaved changes that parks a conflict the user never asked for. Such
 *   notes are skipped and named in the toast — the same call the iCloud
 *   conflict sweep makes.
 * - **Moves carry the session.** {@link moveNoteCarryingSession} flushes,
 *   retargets and re-keys before touching disk, and unwinds exactly what it
 *   did on failure; going around it with a raw move would strand an open pane
 *   on a path that no longer exists.
 * - **A per-note failure doesn't strand the rest.** Notes are processed in
 *   sequence and a failure is recorded, not rethrown mid-batch, so the
 *   remaining notes still land. The toast reports the reason; the caller only
 *   learns whether it fully succeeded, and keeps its selection when it didn't
 *   so the user can retry without re-selecting.
 */
export function useNoteBulkActions(): NoteBulkActions {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const [isRunning, setIsRunning] = useState(false)

  const run = useCallback(
    async (
      label: string,
      paths: readonly string[],
      each: (path: string, generation: number) => Promise<'changed' | 'skipped'>,
    ): Promise<BulkOutcome> => {
      // The loop itself — sequencing, per-note failure collection, cache
      // invalidation, toast wiring — is the shared `runNoteBatch`; this only
      // adds the changed/skipped tally the bulk bar reports.
      const outcome: BulkOutcome = { changed: 0, skipped: 0, blocked: [], ok: true }
      if (paths.length === 0) {
        return outcome
      }
      setIsRunning(true)
      try {
        const { failures, ok } = await runNoteBatch({
          label,
          graph,
          queryClient,
          items: paths,
          describe: basename,
          each: async (path, generation) => {
            if ((await each(path, generation)) === 'changed') {
              outcome.changed += 1
            } else {
              outcome.skipped += 1
            }
          },
        })
        outcome.blocked = failures
        outcome.ok = ok
      } finally {
        setIsRunning(false)
      }
      return outcome
    },
    [graph, queryClient],
  )

  const tag = useCallback(
    async (paths: readonly string[], rawTag: string): Promise<BulkOutcome> => {
      const wanted = rawTag.trim().replace(/^#/, '')
      if (wanted === '') {
        return { changed: 0, skipped: 0, blocked: [], ok: true }
      }
      return await run(`Tagging notes #${wanted}`, paths, async (path, generation) => {
        if (openSession(path)?.isDirty() === true) {
          throw new Error('has unsaved changes')
        }
        const source = await readNoteSource(path)
        const tagged = appendBodyTag(source, wanted)
        if (tagged === null) {
          return 'skipped' // already carries the tag — leave it byte-identical
        }
        await writeNote(path, tagged, generation)
        return 'changed'
      })
    },
    [run],
  )

  const move = useCallback(
    async (paths: readonly string[], folder: string): Promise<BulkOutcome> => {
      const target = folder.replaceAll(/^\/+|\/+$/g, '')
      return await run(
        `Moving notes to ${target === '' ? 'the graph root' : target}`,
        paths,
        async (path, generation) => {
          if (folderOf(path) === target) {
            return 'skipped'
          }
          const to = target === '' ? basename(path) : `${target}/${basename(path)}`
          await moveNoteCarryingSession(path, to, generation)
          return 'changed'
        },
      )
    },
    [run],
  )

  return { tag, move, isRunning }
}
