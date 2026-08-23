import type { ReactElement } from 'react'
import { foldTag } from '@reflect/core'
import { useNoteTags } from '@/hooks/use-note-tags'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'

/**
 * The sidebar's Tags section: every tag carried by a non-daily note, with its
 * note count, alphabetical. A row opens All Notes filtered to that tag — the
 * same view its filter tabs land on, so the section is navigation, not a new
 * surface. Hidden entirely while the graph has no tags, like the Pinned shelf.
 */
export function SidebarTags(): ReactElement | null {
  const tags = useNoteTags()
  const { route, navigate } = useRouter()
  const activeTagKey = route.kind === 'allNotes' && route.tag !== null ? foldTag(route.tag) : null

  if (tags.length === 0) {
    return null
  }

  return (
    <section aria-label="Tags" className="px-4.5">
      <h2 className="pt-4 text-2xs font-medium leading-5 tracking-wide text-text-muted">Tags</h2>
      <ul className="mt-2 flex flex-col space-y-1">
        {tags.map((facet) => {
          const active = activeTagKey !== null && foldTag(facet.tag) === activeTagKey
          return (
            <li key={facet.tag}>
              <button
                type="button"
                onClick={() => navigate({ kind: 'allNotes', tag: facet.tag })}
                className={cn(
                  'group flex w-full items-center rounded-md leading-5 transition-colors duration-[50ms]',
                  active
                    ? 'bg-surface-hover text-text-secondary dark:bg-transparent dark:text-accent'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text',
                )}
              >
                <span className="min-w-0 flex-1 py-1 px-2.5 text-left">
                  <span className="block truncate text-xs font-medium">#{facet.tag}</span>
                </span>
                <span className="shrink-0 px-2.5 text-2xs tabular-nums text-text-muted">
                  {facet.count}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
