import { useQuery } from '@tanstack/react-query'
import {
  listCanvasFiles,
  parseCanvasFile,
  readCanvasFile,
  type CanvasDocument,
} from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
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

/** Read and parse one `.canvas` file; re-read when the index changes. */
export function useCanvasDocument(path: string): CanvasState {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data, error } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'canvas-file', path],
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
