import { useState, type ReactElement } from 'react'
import { foldTag, tagDisplayName } from '@kore/core'
import { Settings } from '@/components/icons'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import { TagIcon } from '@/components/tags/tag-icon'
import { useTagIcons } from '@/hooks/use-tag-icons'
import { useTypeShelves } from '@/hooks/use-type-shelves'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'
import { SidebarSortableSection } from './sidebar-sortable-section'

/**
 * The sidebar's Types section: what notes *are*. One flat row per tag with a
 * definition note (`tags/<key>.md`), sorted by name, each opening that type's
 * database (All Notes filtered to its members) with its member count. A type
 * no note is yet still lists, at 0, so a freshly made type is easy to find.
 * Hovering a row reveals its configure button, the same dialog as a tag's.
 *
 * Shown whenever the vault has tags at all: with no type yet it says how to
 * make one, because that is the step that turns a topic into a database.
 */
export function SidebarTypes(): ReactElement | null {
  const { types, tags } = useTypeShelves()
  const icons = useTagIcons()
  const { route, navigate } = useRouter()
  const [configuring, setConfiguring] = useState<string | null>(null)

  if (types.length === 0 && tags.length === 0) {
    return null
  }
  const activeKey =
    route.kind === 'allNotes' && route.filter.kind === 'tag' ? foldTag(route.filter.tag) : null

  return (
    <SidebarSortableSection id="types" title="Types" label="Types">
      {types.length === 0 ? (
        <p className="mt-2 px-2.5 text-2xs leading-4 text-text-muted">
          No types yet. Configure a tag below to give it fields, and it becomes a type with its own
          database.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col space-y-1">
          {types.map((entry) => (
            <li key={entry.key}>
              <div
                className={cn(
                  'group relative flex w-full items-center rounded-md pl-2.5 leading-5 transition-colors duration-[50ms]',
                  entry.key === activeKey
                    ? 'bg-surface-hover text-text-secondary dark:bg-transparent dark:text-accent'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text',
                )}
              >
                <button
                  type="button"
                  onClick={() =>
                    navigate({ kind: 'allNotes', filter: { kind: 'tag', tag: entry.tag } })
                  }
                  className="flex min-w-0 flex-1 items-center text-left"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 py-1">
                    <TagIcon
                      icon={icons.get(entry.key)}
                      className="size-3.5"
                      emojiClassName="text-xs"
                    />
                    <span className="min-w-0 truncate text-xs font-medium">
                      {tagDisplayName(entry.name)}
                    </span>
                  </span>
                  <span className="shrink-0 px-2.5 text-2xs tabular-nums text-text-muted transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
                    {entry.count}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Configure type #${entry.key}`}
                  onClick={() => setConfiguring(entry.tag)}
                  className="absolute right-1.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-text-muted opacity-0 transition-[color,background-color,opacity] duration-150 ease-swift hover:bg-surface-active hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Settings aria-hidden className="size-3" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {configuring !== null ? (
        <TagConfigDialog tag={configuring} onClose={() => setConfiguring(null)} />
      ) : null}
    </SidebarSortableSection>
  )
}
