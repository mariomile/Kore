import { useQuery } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { listTagMentions } from '@kore/core'
import { ChevronRight } from '@/components/icons'
import { useBacklinkNavigation } from '@/hooks/use-backlink-navigation'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

/** Rows shown before "Show all", so a much-mentioned tag keeps its table in view. */
const COLLAPSED_MENTION_LIMIT = 20

interface TagMentionsSectionProps {
  /** The routed tag, or `null` off a tag page (renders nothing). */
  tag: string | null
}

/**
 * The tag page's "Mentioned in" disclosure: notes whose prose names the tag
 * without being one of its rows. Collapsed by default, so the collection stays
 * the page; renders nothing when nothing only mentions the tag.
 */
export function TagMentionsSection({ tag }: TagMentionsSectionProps): ReactElement | null {
  const { graph } = useGraph()
  const bridgeReady = useBridgeReady()
  const { openSource } = useBacklinkNavigation()
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const { data: mentions } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'tag-mentions', tag ?? ''],
    queryFn: () => listTagMentions(tag ?? ''),
    enabled: bridgeReady && graph !== null && tag !== null,
  })

  if (tag === null || mentions === undefined || mentions.length === 0) {
    return null
  }

  return (
    <section aria-label={`Mentions of #${tag}`} className="flex-none pb-3 pl-12 pr-7">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded(!expanded)
        }}
        className="flex items-center gap-2 text-left text-xs font-medium text-text-muted hover:text-text"
      >
        <ChevronRight
          aria-hidden
          className={`size-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span>
          Mentioned in {mentions.length} note{mentions.length === 1 ? '' : 's'}
        </span>
      </button>
      {expanded ? (
        <ul className="mt-2 flex max-h-64 flex-col overflow-y-auto pl-5">
          {(showAll ? mentions : mentions.slice(0, COLLAPSED_MENTION_LIMIT)).map((mention) => (
            <li key={mention.path}>
              <button
                type="button"
                onClick={(event) => {
                  openSource(mention.path, event)
                }}
                className="-ml-2 block w-[calc(100%+0.5rem)] truncate rounded-md px-2 py-1 text-left text-sm text-text hover:bg-surface-hover hover:text-accent"
              >
                {mention.title}
              </button>
            </li>
          ))}
          {!showAll && mentions.length > COLLAPSED_MENTION_LIMIT ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  setShowAll(true)
                }}
                className="-ml-2 mt-1 rounded-md px-2 py-1 text-left text-xs text-text-muted hover:bg-surface-hover hover:text-text"
              >
                Show all {mentions.length}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  )
}
