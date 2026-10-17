import { useState, type ReactElement } from 'react'
import { foldTag, hasNestedTags, tagDisplayName, type TagTreeNode } from '@reflect/core'
import { ChevronDown, ChevronRight, Settings } from '@/components/icons'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import { TagIcon } from '@/components/tags/tag-icon'
import { useTagIcons } from '@/hooks/use-tag-icons'
import { useTagTree } from '@/hooks/use-tag-tree'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'
import { SidebarSortableSection } from './sidebar-sortable-section'
import { useSessionExpanded } from './use-session-expanded'

const EXPANDED_KEY = 'reflect.workspace-sidebar.tags.expanded'
const INDENT_PX = 12
const BASE_PADDING_PX = 10

interface TagTreeContext {
  expanded: ReadonlySet<string>
  toggle: (key: string) => void
  activeKey: string | null
  /** Whether any tag nests — only then do rows reserve a chevron column. */
  nested: boolean
  icons: ReadonlyMap<string, string>
  open: (tag: string) => void
  configure: (tag: string) => void
}

/**
 * The sidebar's Types section — user-facing copy calls a tag a type: every
 * tag carried by a non-daily note, alphabetical, nested on `/` the way
 * Obsidian nests `#domain/ai` under `#domain`. A child shows its last
 * segment; a parent's count and its page cover its whole subtree, and the
 * chevron beside it expands it (remembered for the session). A row opens
 * All Notes filtered to that tag — the same view its filter tabs land on, so
 * the section is navigation, not a new surface. Hidden entirely while the
 * graph has no tags, like the Pinned shelf. Every tag is a collection, so no
 * row is marked as one; hovering a row reveals its configure button (TDR
 * 0005), which edits the tag's property schema in `tags/<key>.md`.
 */
export function SidebarTags(): ReactElement | null {
  const tree = useTagTree()
  const icons = useTagIcons()
  const { route, navigate } = useRouter()
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [expanded, toggle] = useSessionExpanded(EXPANDED_KEY)

  if (tree.length === 0) {
    return null
  }

  const context: TagTreeContext = {
    expanded,
    toggle,
    activeKey:
      route.kind === 'allNotes' && route.filter.kind === 'tag' ? foldTag(route.filter.tag) : null,
    nested: hasNestedTags(tree),
    icons,
    open: (tag) => navigate({ kind: 'allNotes', filter: { kind: 'tag', tag } }),
    configure: setConfiguring,
  }
  return (
    <SidebarSortableSection id="tags" title="Types" label="Types">
      <ul className="mt-2 flex flex-col space-y-1">
        {tree.map((node) => (
          <TagRow key={node.key} node={node} depth={0} context={context} />
        ))}
      </ul>
      {configuring !== null ? (
        <TagConfigDialog tag={configuring} onClose={() => setConfiguring(null)} />
      ) : null}
    </SidebarSortableSection>
  )
}

interface TagRowProps {
  node: TagTreeNode
  depth: number
  context: TagTreeContext
}

function TagRow({ node, depth, context }: TagRowProps): ReactElement {
  const active = node.key === context.activeKey
  const hasChildren = node.children.length > 0
  const isOpen = hasChildren && context.expanded.has(node.key)
  const Chevron = isOpen ? ChevronDown : ChevronRight
  return (
    <li>
      <div
        className={cn(
          'group relative flex w-full items-center rounded-md leading-5 transition-colors duration-[50ms]',
          active
            ? 'bg-surface-hover text-text-secondary dark:bg-transparent dark:text-accent'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text',
        )}
        style={{ paddingLeft: BASE_PADDING_PX + depth * INDENT_PX }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} #${node.tag}`}
            onClick={() => context.toggle(node.key)}
            className="mr-1 flex size-3.5 flex-none items-center justify-center rounded text-text-muted hover:text-text"
          >
            <Chevron aria-hidden className="size-3" />
          </button>
        ) : context.nested ? (
          <span aria-hidden className="mr-1 size-3.5 flex-none" />
        ) : null}
        <button
          type="button"
          onClick={() => context.open(node.tag)}
          className="flex min-w-0 flex-1 items-center text-left"
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 py-1">
            <TagIcon
              icon={context.icons.get(node.key)}
              className="size-3.5"
              emojiClassName="text-xs"
            />
            <span className="min-w-0 truncate text-xs font-medium">
              {tagDisplayName(node.name)}
            </span>
          </span>
          <span className="shrink-0 px-2.5 text-2xs tabular-nums text-text-muted transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
            {node.count}
          </span>
        </button>
        <button
          type="button"
          aria-label={`Configure #${node.tag}`}
          onClick={() => context.configure(node.tag)}
          className="absolute right-1.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded text-text-muted opacity-0 transition-[color,background-color,opacity] duration-150 ease-swift hover:bg-surface-active hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Settings aria-hidden className="size-3" />
        </button>
      </div>
      {isOpen ? (
        <ul className="mt-1 flex flex-col space-y-1">
          {node.children.map((child) => (
            <TagRow key={child.key} node={child} depth={depth + 1} context={context} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
