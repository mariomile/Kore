import { useState, type ReactElement } from 'react'
import { foldTag } from '@reflect/core'
import { Settings } from '@/components/icons'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import { useNoteTags } from '@/hooks/use-note-tags'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'
import { SidebarSortableSection } from './sidebar-sortable-section'

/**
 * The sidebar's Tags section: every tag carried by a non-daily note, with its
 * note count, alphabetical. A row opens All Notes filtered to that tag — the
 * same view its filter tabs land on, so the section is navigation, not a new
 * surface. Hidden entirely while the graph has no tags, like the Pinned shelf.
 * Every tag is a collection, so no row is marked as one; hovering a row
 * reveals "Configure tag" (TDR 0005), which edits the tag's property schema
 * in `tags/<key>.md`.
 */
export function SidebarTags(): ReactElement | null {
  const tags = useNoteTags()
  const { route, navigate } = useRouter()
  const [configuring, setConfiguring] = useState<string | null>(null)
  const activeTagKey = route.kind === 'allNotes' && route.tag !== null ? foldTag(route.tag) : null

  if (tags.length === 0) {
    return null
  }

  return (
    <SidebarSortableSection id="tags" title="Tags" label="Tags">
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
    </SidebarSortableSection>
  )
}
