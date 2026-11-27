import { useMemo, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getGraphMap } from '@kore/core'
import { ArrowRight } from '@/components/icons'
import { graphCanvasView } from '@/components/graph-map/graph-canvas-view'
import { GraphMapCanvas } from '@/components/graph-map/graph-map-canvas'
import { Button } from '@/components/ui/button'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

interface GraphPreviewProps {
  onOpenNote: (path: string) => void
  onOpenGraph: () => void
}

/**
 * The vault's link map, unframed, drawn once the first index is whole —
 * the canvas settles from a spiral into its shape, which is the graph
 * "lighting up". Loading it any earlier would rebuild the layout of
 * thousands of nodes on every batch. Shares the Graph view's query, so
 * opening the full view afterwards is instant.
 */
export function GraphPreview({ onOpenNote, onOpenGraph }: GraphPreviewProps): ReactElement | null {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'graph-map'],
    queryFn: getGraphMap,
    enabled: bridgeReady && graph !== null,
  })
  const view = useMemo(
    () => (data === undefined ? null : graphCanvasView(data, { showDailies: false })),
    [data],
  )
  if (view === null || view.nodes.length === 0) {
    return null
  }
  return (
    <section aria-label="Your graph">
      <div className="flex items-baseline gap-3">
        <h2 className="text-2xs font-medium tracking-wide text-text-muted">Your graph</h2>
        <span className="text-xs text-text-muted tabular-nums">
          {view.nodes.length.toLocaleString()} notes · {view.edges.length.toLocaleString()} links
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto rounded-full text-text-secondary"
          onClick={onOpenGraph}
        >
          Open Graph
          <ArrowRight aria-hidden />
        </Button>
      </div>
      {/* No frame: the map melts into the page at its edges. */}
      <div className="graph-preview-fade mt-2 h-96 overflow-hidden rounded-2xl">
        <GraphMapCanvas
          nodes={view.nodes}
          edges={view.edges}
          wheelZoom="modifier"
          label="Graph of your vault"
          onOpen={(path) => onOpenNote(path)}
        />
      </div>
    </section>
  )
}
