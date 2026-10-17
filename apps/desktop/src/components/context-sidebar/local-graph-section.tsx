import { useMemo, useState, type ReactElement } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  displayNoteTitle,
  foldTag,
  getLocalGraph,
  noteFileStem,
  type LocalGraph,
  type LocalGraphDepth,
  type LocalGraphNode,
} from '@reflect/core'
import {
  GraphMapCanvas,
  type CanvasEdge,
  type CanvasNode,
} from '@/components/graph-map/graph-map-canvas'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { tagColorCss } from '@/lib/graph-colors'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { SidebarSection } from './sidebar-section'

interface LocalGraphSectionProps {
  /** Graph-relative path of the note the local graph centers on. */
  path: string
}

function nodeLabel(node: LocalGraphNode): string {
  if (node.kind === 'tag') {
    return `#${node.tag ?? ''}`
  }
  if (node.dailyDate !== null) {
    return node.dailyDate
  }
  return displayNoteTitle(node.title === '' ? noteFileStem(node.id) : node.title)
}

/** The canvas's view of a local graph; node size follows local link count. */
function canvasView(graph: LocalGraph): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const degree = new Map<string, number>()
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + edge.weight)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + edge.weight)
  }
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      label: nodeLabel(node),
      inbound: degree.get(node.id) ?? 0,
      isDaily: node.dailyDate !== null,
      color: node.tag === null ? null : tagColorCss(foldTag(node.tag)),
      emphasis: node.depth === 0,
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  }
}

const controlClass =
  'rounded px-1.5 py-0.5 text-2xs font-medium transition-colors duration-100 hover:bg-surface-hover hover:text-text'

/**
 * The open note's neighborhood as a small graph (Obsidian's local graph):
 * the note, its links, backlinks and `up:`/`related:` links, with a depth
 * 1/2 switch and tags off by default. Click opens a note, ⌘-click opens it
 * beside this one, a tag opens its note list, and "Open in Graph" hands off
 * to the full map focused here. The body only mounts while the section is
 * open, so a collapsed section queries and lays out nothing.
 */
export function LocalGraphSection({ path }: LocalGraphSectionProps): ReactElement {
  return (
    <SidebarSection storageKey="local-graph" title="Local graph">
      <LocalGraphBody path={path} />
    </SidebarSection>
  )
}

function LocalGraphBody({ path }: LocalGraphSectionProps): ReactElement {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { navigate } = useRouter()
  const navigateNoteLink = useNoteLinkNavigation()
  const [depth, setDepth] = useState<LocalGraphDepth>(1)
  const [tags, setTags] = useState(false)

  const { data, isError } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'local-graph', path, depth, tags],
    queryFn: () => getLocalGraph(path, { depth, tags }),
    enabled: bridgeReady && graph !== null,
    // Switching depth keeps the old map up until the new one lands.
    placeholderData: keepPreviousData,
  })
  // Index writes refetch this query; structural sharing hands back the same
  // object when nothing changed, so typing in the note never re-lays it out.
  const view = useMemo(() => (data === undefined ? null : canvasView(data)), [data])

  if (isError) {
    return <p className="px-2.5 py-2 text-xs text-text-muted">Couldn’t load the local graph.</p>
  }

  const lonely = view !== null && view.nodes.length <= 1
  return (
    <div>
      {view === null ? (
        <div className="h-52" />
      ) : lonely ? (
        <p className="px-2.5 py-2 text-xs text-text-muted">No links yet.</p>
      ) : (
        <div className="h-52">
          <GraphMapCanvas
            nodes={view.nodes}
            edges={view.edges}
            wheelZoom="modifier"
            label="Local graph"
            onOpen={(id, openInSplit) => {
              if (id.startsWith('#')) {
                navigate({ kind: 'allNotes', filter: { kind: 'tag', tag: id.slice(1) } })
              } else if (id !== path) {
                navigateNoteLink({ target: routeForPath(id), openInSplit })
              }
            }}
          />
        </div>
      )}
      <div className="flex items-center gap-0.5 px-1 pt-1 text-text-secondary">
        {([1, 2] as const).map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={depth === level}
            aria-label={`Depth ${level}`}
            onClick={() => {
              setDepth(level)
            }}
            className={cn(controlClass, depth === level && 'bg-surface-hover text-text')}
          >
            {level}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={tags}
          onClick={() => {
            setTags((current) => !current)
          }}
          className={cn(controlClass, tags && 'bg-surface-hover text-text')}
        >
          Tags
        </button>
        {data === undefined || data.hidden === 0 ? null : (
          <span className="px-1 text-2xs text-text-muted">+{data.hidden} more</span>
        )}
        <button
          type="button"
          onClick={() => {
            navigate({ kind: 'graphMap', focus: path })
          }}
          className={cn(controlClass, 'ml-auto')}
        >
          Open in Graph
        </button>
      </div>
    </div>
  )
}
