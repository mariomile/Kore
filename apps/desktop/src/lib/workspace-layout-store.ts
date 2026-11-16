import type { OpenColumn, WorkspaceLayout } from '@kore/core'

/** A graph's columns, rewritten whole: return `columns` itself for "no change". */
export type LayoutMutation = (columns: readonly OpenColumn[]) => readonly OpenColumn[]

export interface WorkspaceLayoutStore {
  /** The graph's stored columns, or a shared empty list when it has none. */
  columnsOf(root: string): readonly OpenColumn[]
  subscribe(listener: () => void): () => void
  /**
   * Apply `mutate` to one graph's columns. Before the stored document has been
   * read, mutations queue and replay over it, so a tab recorded at launch
   * cannot erase the layout the disk is about to restore.
   */
  update(root: string, mutate: LayoutMutation): void
  /** Read the stored document once and replay the queued mutations over it. */
  hydrate(): Promise<void>
}

interface WorkspaceLayoutIo {
  load(): Promise<WorkspaceLayout>
  save(layout: WorkspaceLayout): Promise<void>
  onLoadError(error: unknown): void
  onSaveError(error: unknown): void
}

const NO_COLUMNS: readonly OpenColumn[] = []

/**
 * The main window's per-graph layout as an external store, so a navigation
 * re-renders only the subscribers of that graph's columns. Every change is
 * persisted once per tick, in apply order. After a failed load nothing is
 * written: saving over an unread document would wipe it.
 */
export function createWorkspaceLayoutStore(io: WorkspaceLayoutIo): WorkspaceLayoutStore {
  let layout: WorkspaceLayout = {}
  let status: 'pending' | 'loaded' | 'failed' = 'pending'
  let queued: [string, LayoutMutation][] = []
  let hydration: Promise<void> | null = null
  let saveScheduled = false
  let saves = Promise.resolve()
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  function scheduleSave(): void {
    if (status !== 'loaded' || saveScheduled) {
      return
    }
    saveScheduled = true
    queueMicrotask(() => {
      saveScheduled = false
      const snapshot = layout
      saves = saves.then(() => io.save(snapshot)).catch(io.onSaveError)
    })
  }

  function apply(root: string, mutate: LayoutMutation): boolean {
    const current = layout[root] ?? NO_COLUMNS
    const next = mutate(current)
    if (next === current) {
      return false
    }
    layout = { ...layout, [root]: [...next] }
    return true
  }

  return {
    columnsOf: (root) => layout[root] ?? NO_COLUMNS,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(root, mutate) {
      if (status === 'pending') {
        queued.push([root, mutate])
        return
      }
      if (apply(root, mutate)) {
        emit()
        scheduleSave()
      }
    },
    hydrate() {
      hydration ??= io
        .load()
        .then(
          (stored) => {
            layout = stored
            status = 'loaded'
          },
          (error: unknown) => {
            status = 'failed'
            io.onLoadError(error)
          },
        )
        .then(() => {
          const replay = queued
          queued = []
          const changed = replay.map(([root, mutate]) => apply(root, mutate)).some(Boolean)
          emit()
          if (changed) {
            scheduleSave()
          }
        })
      return hydration
    },
  }
}
