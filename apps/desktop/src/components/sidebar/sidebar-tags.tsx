import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { foldTag, listTagTypes } from '@reflect/core'
import { Layers, Settings } from '@/components/icons'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { useNoteTags } from '@/hooks/use-note-tags'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'
import { SidebarDisclosure } from './sidebar-disclosure'

/**
 * The sidebar's Tags section: every tag carried by a non-daily note, with its
 * note count, alphabetical. A row opens All Notes filtered to that tag — the
 * same view its filter tabs land on, so the section is navigation, not a new
 * surface. Hidden entirely while the graph has no tags, like the Pinned shelf.
 * Hovering a row reveals "Configure tag" (TDR 0005), which edits the tag's
 * type — its property schema — in `tags/<key>.md`.
 */
interface SidebarTagsProps {
  /** Rendered instead of nothing when the graph has no tags yet (the right
   * rail's Tags panel wants an honest empty state; the left rail hides). */
  emptyNotice?: ReactElement
}

export function SidebarTags({ emptyNotice }: SidebarTagsProps = {}): ReactElement | null {
  const tags = useNoteTags()
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { route, navigate } = useRouter()
  const [configuring, setConfiguring] = useState<string | null>(null)
  const activeTagKey = route.kind === 'allNotes' && route.tag !== null ? foldTag(route.tag) : null
  // Which tags are types (TDR 0005) — those rows carry the collection glyph.
  const { data: tagTypes } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'tag-types'],
    queryFn: () => listTagTypes(),
    enabled: bridgeReady && graph !== null,
  })
  const typedKeys = new Set((tagTypes ?? []).map((entry) => entry.tagKey))

  if (tags.length === 0) {
    return emptyNotice ?? null
  }

  return (
    <SidebarDisclosure storageKey="tags" title="Tags" label="Tags">
      <ul className="mt-2 flex flex-col space-y-1">
        {tags.map((facet) => {
          const active = activeTagKey !== null && foldTag(facet.tag) === activeTagKey
          return (
            <li key={facet.tag} className="group relative">
              <button
                type="button"
                onClick={() => navigate({ kind: 'allNotes', tag: facet.tag })}
                className={cn(
                  'flex w-full items-center rounded-md leading-5 transition-colors duration-[50ms]',
                  active
                    ? 'bg-surface-hover text-text-secondary dark:bg-transparent dark:text-accent'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text',
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5 py-1 px-2.5 text-left">
                  <span className="min-w-0 truncate text-xs font-medium">#{facet.tag}</span>
                  {typedKeys.has(foldTag(facet.tag)) ? (
                    <Layers
                      aria-label="Has a collection"
                      className="size-3 shrink-0 text-text-muted"
                    />
                  ) : null}
                </span>
                <span className="shrink-0 px-2.5 text-2xs tabular-nums text-text-muted transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
                  {facet.count}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Configure #${facet.tag}`}
                onClick={() => setConfiguring(facet.tag)}
                className="absolute right-1.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded text-text-muted opacity-0 transition-[color,background-color,opacity] duration-150 ease-swift hover:bg-surface-active hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Settings aria-hidden className="size-3" />
              </button>
            </li>
          )
        })}
      </ul>
      {configuring !== null ? (
        <TagConfigDialog tag={configuring} onClose={() => setConfiguring(null)} />
      ) : null}
    </SidebarDisclosure>
  )
}
