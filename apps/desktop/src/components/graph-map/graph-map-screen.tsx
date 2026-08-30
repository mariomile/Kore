import { useMemo, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  displayNoteTitle,
  foldTag,
  getGraphMap,
  noteFileStem,
  type GraphMapNode,
} from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { tagColorCss } from '@/lib/graph-colors'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { GraphMapCanvas, type CanvasNode } from './graph-map-canvas'

/** The label a node renders: title, else the daily date, else the file stem. */
function nodeLabel(node: GraphMapNode): string {
  if (node.dailyDate !== null) {
    return node.dailyDate
  }
  return displayNoteTitle(node.title === '' ? noteFileStem(node.path) : node.title)
}

/**
 * The Graph view: the whole graph's notes and resolved wiki links as a
 * force-directed map (docs/roadmap.md). Everything is computed locally from
 * the index — pan/zoom to explore, hover to spotlight a note's
 * neighborhood, drag to rearrange, click to open the note. Daily notes are
 * hidden by default (they mostly orbit as unlinked satellites and drown the
 * idea structure); the toggle brings them in, edges included.
 */
export function GraphMapScreen(): ReactElement {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { navigate } = useRouter()
  const [showDailies, setShowDailies] = useState(false)
  const [query, setQuery] = useState('')

  const { data, isError } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'graph-map'],
    queryFn: getGraphMap,
    enabled: bridgeReady && graph !== null,
  })

  const view = useMemo(() => {
    if (data === undefined) {
      return null
    }
    const nodes: CanvasNode[] = data.nodes
      .filter((node) => showDailies || node.dailyDate === null)
      .map((node) => ({
        id: node.path,
        label: nodeLabel(node),
        inbound: node.inbound,
        isDaily: node.dailyDate !== null,
        // One hue per first tag: clusters that share a topic read as one
        // color. Untagged notes keep the neutral fill.
        color: node.tag === null ? null : tagColorCss(foldTag(node.tag)),
      }))
    const kept = new Set(nodes.map((node) => node.id))
    const edges = data.edges
      .filter((edge) => kept.has(edge.source) && kept.has(edge.target))
      .map((edge) => ({ source: edge.source, target: edge.target, weight: edge.weight }))
    return { nodes, edges }
  }, [data, showDailies])

  // The header search lights matching notes up in place — a filter would
  // tear the layout apart, a highlight keeps the neighborhood readable.
  const matches = useMemo(() => {
    const folded = query.trim().toLowerCase()
    if (folded === '' || view === null) {
      return null
    }
    return new Set(
      view.nodes
        .filter(
          (node) =>
            node.label.toLowerCase().includes(folded) || node.id.toLowerCase().includes(folded),
        )
        .map((node) => node.id),
    )
  }, [view, query])

  if (isError) {
    return (
      <p role="alert" className="px-6 py-8 text-sm text-text-muted">
        Couldn’t load the graph.
      </p>
    )
  }
  if (view === null) {
    return <p className="px-6 py-8 text-sm text-text-muted">Loading…</p>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-baseline gap-3 px-6 pb-2 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Graph</h1>
        <span className="text-xs text-text-muted">
          {view.nodes.length} notes · {view.edges.length} links
          {matches === null ? '' : ` · ${matches.size} highlighted`}
        </span>
        <input
          type="search"
          value={query}
          aria-label="Highlight notes"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="Highlight notes…"
          className="ml-auto h-7 w-48 rounded-md border border-border bg-input-bg px-2.5 text-xs text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        />
        <label
          className={cn(
            'flex cursor-default items-center gap-1.5 text-xs font-medium',
            showDailies ? 'text-text' : 'text-text-secondary',
          )}
        >
          <input
            type="checkbox"
            checked={showDailies}
            onChange={(event) => {
              setShowDailies(event.target.checked)
            }}
            className="accent-[var(--accent)]"
          />
          Daily notes
        </label>
      </div>

      {view.nodes.length === 0 ? (
        <p className="px-6 py-8 text-sm text-text-muted">
          Nothing to map yet — link some notes with [[wiki links]].
        </p>
      ) : (
        <div className="min-h-0 flex-1">
          <GraphMapCanvas
            nodes={view.nodes}
            edges={view.edges}
            matches={matches}
            onOpen={(path) => navigate(routeForPath(path))}
          />
        </div>
      )}
    </div>
  )
}
