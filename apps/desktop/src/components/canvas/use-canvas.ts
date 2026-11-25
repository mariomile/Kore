import { useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  applyCanvasEdits,
  listCanvasFiles,
  parseCanvasFile,
  readCanvasFile,
  writeCanvasFile,
  type CanvasDocument,
  type CanvasEdit,
} from '@kore/core'
import { toast } from '@/components/ui/toast'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { isMobileSurface } from '@/lib/platform-surface'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** The `.canvas` files in the vault, sorted by path. */
export function useCanvasFiles(): { paths: readonly string[] | undefined; failed: boolean } {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data, isError } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'canvas-files'],
    queryFn: () => listCanvasFiles(graph?.generation),
    enabled: bridgeReady && graph !== null,
  })
  return { paths: data, failed: isError }
}

export type CanvasState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; canvas: CanvasDocument }

function canvasFileKey(root: string | undefined, path: string): readonly unknown[] {
  return [INDEX_QUERY_SCOPE, root, 'canvas-file', path]
}

/** Read and parse one `.canvas` file; re-read when the index changes. */
export function useCanvasDocument(path: string): CanvasState {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data, error } = useQuery({
    queryKey: canvasFileKey(graph?.root, path),
    queryFn: async () => {
      if (graph === null) {
        throw new Error('No vault is open.')
      }
      return parseCanvasFile(await readCanvasFile(path, graph.generation))
    },
    enabled: bridgeReady && graph !== null,
    retry: false,
  })
  if (error !== null) {
    return { status: 'error', message: error.message }
  }
  return data === undefined ? { status: 'loading' } : { status: 'ready', canvas: data }
}

/** Writes to one canvas file, in order, with an undo history. */
export interface CanvasEditor {
  apply: (edits: readonly CanvasEdit[]) => Promise<void>
  /** Put the file back as it was before the last edit made here. */
  undo: () => Promise<void>
}

/** How many edits ⌘Z can walk back. */
const UNDO_DEPTH = 50

/**
 * The Mac's light canvas editing; null on the iPhone, where canvases stay
 * read-only. Each edit reads the file fresh and patches its JSON (so a
 * change an agent or Obsidian made meanwhile is kept), writes it, and
 * shows the result at once. Edits run one at a time so two quick drags
 * never race each other's read.
 */
export function useCanvasEditor(path: string): CanvasEditor | null {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const queue = useRef<Promise<void>>(Promise.resolve())
  const history = useRef<string[]>([])
  const root = graph?.root
  const generation = graph?.generation ?? null

  return useMemo((): CanvasEditor | null => {
    if (generation === null || isMobileSurface()) {
      return null
    }
    const key = canvasFileKey(root, path)
    const run = (step: () => Promise<void>): Promise<void> => {
      const next = queue.current.then(step).catch((error: unknown) => {
        toast.add({
          type: 'error',
          title: 'Couldn’t save the canvas',
          description: error instanceof Error ? error.message : undefined,
        })
        void queryClient.invalidateQueries({ queryKey: key })
      })
      queue.current = next
      return next
    }
    const write = async (source: string): Promise<void> => {
      await writeCanvasFile(path, source, generation)
      queryClient.setQueryData(key, parseCanvasFile(source))
    }
    return {
      apply: (edits) =>
        run(async () => {
          const before = await readCanvasFile(path, generation)
          const after = applyCanvasEdits(before, edits)
          await write(after)
          history.current = [...history.current, before].slice(-UNDO_DEPTH)
        }),
      undo: () =>
        run(async () => {
          const previous = history.current.at(-1)
          if (previous !== undefined) {
            history.current = history.current.slice(0, -1)
            await write(previous)
          }
        }),
    }
  }, [generation, path, queryClient, root])
}
