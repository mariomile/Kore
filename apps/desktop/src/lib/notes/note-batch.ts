import type { QueryClient } from '@tanstack/react-query'
import { errorMessage } from '@reflect/core'
import { startOperation } from '@/lib/operations'
import { allNotesListPrefix } from './all-notes-query'

export interface NoteBatchGraph {
  root: string
  generation: number
}

export interface NoteBatchOptions<T> {
  /** The operations-toast label ("Tagging notes #reading"). */
  label: string
  /** The open graph, or null/undefined — reported as a failure, never thrown. */
  graph: NoteBatchGraph | null | undefined
  queryClient: QueryClient
  items: readonly T[]
  /** How a failed item is named in the toast. */
  describe: (item: T) => string
  /**
   * Process one item; throw to record a failure. Accumulate outcomes
   * (counters, undo entries) by closing over them — the batch only tracks
   * what failed.
   */
  each: (item: T, generation: number) => Promise<void>
}

export interface NoteBatchResult {
  /** One "name: reason" line per failed item, in order. */
  failures: string[]
  /** True when nothing failed; callers clear selections on true. */
  ok: boolean
}

/**
 * The one loop every bulk note operation shares — tag, move, vault replace,
 * its undo. The shape was written three times in as many days before being
 * extracted, and the rules it encodes are the ones each copy had to restate:
 *
 * - **Sequential on purpose.** Every current caller writes; overlapping
 *   writes would interleave with the per-note gates callers run inside
 *   `each`. (Reads that want a pool — the replace *scan* — don't use this.)
 * - **A per-item failure doesn't strand the rest**: it is recorded with the
 *   item's name and the loop continues, so a partial batch still lands and
 *   the toast names exactly what didn't.
 * - **The list caches drop at the end** whether or not anything failed — the
 *   list only refreshes when the watcher's reindex batch applies, a visible
 *   beat later, and a partially-applied batch still changed notes.
 * - **A missing graph reports through the toast**, never a silent nothing
 *   and never a throw.
 */
export async function runNoteBatch<T>({
  label,
  graph,
  queryClient,
  items,
  describe,
  each,
}: NoteBatchOptions<T>): Promise<NoteBatchResult> {
  if (items.length === 0) {
    return { failures: [], ok: true }
  }
  if (graph === null || graph === undefined) {
    startOperation(label).fail('No graph is open.')
    return { failures: [], ok: false }
  }
  const operation = startOperation(label)
  const failures: string[] = []
  for (const [index, item] of items.entries()) {
    operation.progress(index, items.length)
    try {
      await each(item, graph.generation)
    } catch (cause) {
      failures.push(`${describe(item)}: ${errorMessage(cause)}`)
    }
  }
  await queryClient.invalidateQueries({ queryKey: allNotesListPrefix(graph.root) })
  if (failures.length === 0) {
    operation.done()
  } else {
    operation.fail(failures.join('; '))
  }
  return { failures, ok: failures.length === 0 }
}
