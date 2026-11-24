import { useState, type ReactElement } from 'react'
import { foldTag, tagDisplayName, type TagTreeNode } from '@kore/core'
import { Settings } from '@/components/icons'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import { TagIcon } from '@/components/tags/tag-icon'
import { useTagIcons } from '@/hooks/use-tag-icons'
import { useTypeShelves } from '@/hooks/use-type-shelves'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'
import { SidebarIconSlot } from './sidebar-icon-slot'
import { SidebarSortableSection } from './sidebar-sortable-section'
import { SIDEBAR_TREE_ROW_CLASS, SidebarTreeIcon, sidebarTreePadding } from './sidebar-tree-icon'
import { useSessionExpanded } from './use-session-expanded'

const EXPANDED_KEY = 'kore.workspace-sidebar.tags.expanded'

interface TagTreeContext {
  expanded: ReadonlySet<string>
  toggle: (key: string) => void
  activeKey: string | null
  icons: ReadonlyMap<string, string>
  open: (tag: string) => void
  configure: (tag: string) => void
}

/**
 * The sidebar's unified Tags section (TDR 0005 Amendment I): configured tags
 * sit pinned at the top (carrying any unconfigured sub-tags beneath them via
 * `splitTypesFromTags`), followed by a subtle divider and every remaining tag.
 * Hovering any row reveals its configure button.
 */
export function SidebarTags(): ReactElement | null {
  const { types: pinnedNodes, tags: remainingTree } = useTypeShelves()
  const icons = useTagIcons()
  const { route, navigate } = useRouter()
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [expanded, toggle] = useSessionExpanded(EXPANDED_KEY)

  if (pinnedNodes.length === 0 && remainingTree.length === 0) {
    return null
  }

  const activeKey =
    route.kind === 'allNotes' && route.filter.kind === 'tag' ? foldTag(route.filter.tag) : null
  const shared: TagTreeContext = {
    expanded,
    toggle,
    activeKey,
    icons,
    open: (tag: string) => navigate({ kind: 'allNotes', filter: { kind: 'tag', tag } }),
    configure: setConfiguring,
  }

  return (
    <SidebarSortableSection id="tags" title="Tags" label="Tags">
      {pinnedNodes.length > 0 ? (
        <ul className="mt-2 flex flex-col space-y-px">
          {pinnedNodes.map((node) => (
            <TagRow key={node.key} node={node} depth={0} context={shared} />
          ))}
        </ul>
      ) : null}
      {pinnedNodes.length > 0 && remainingTree.length > 0 ? (
        <div role="separator" className="mx-2.5 my-1.5 border-t border-border/60" />
      ) : null}
      {remainingTree.length > 0 ? (
        <ul className={cn('flex flex-col space-y-px', pinnedNodes.length === 0 && 'mt-2')}>
          {remainingTree.map((node) => (
            <TagRow key={node.key} node={node} depth={0} context={shared} />
          ))}
        </ul>
      ) : null}
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
  const icon = (
    <TagIcon icon={context.icons.get(node.key)} className="size-3.5" emojiClassName="text-xs" />
  )
  return (
    <li>
      <div
        className={cn(
          SIDEBAR_TREE_ROW_CLASS,
          'group relative flex w-full items-center gap-3 rounded-md leading-5 transition-colors duration-[50ms]',
          active
            ? 'bg-surface-hover text-text-secondary dark:bg-transparent dark:text-accent'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text',
        )}
        style={{ paddingLeft: sidebarTreePadding(depth) }}
      >
        {hasChildren ? (
          <SidebarTreeIcon
            icon={icon}
            open={isOpen}
            toggle={{
              label: `${isOpen ? 'Collapse' : 'Expand'} #${node.tag}`,
              onToggle: () => context.toggle(node.key),
            }}
          />
        ) : null}
        <button
          type="button"
          onClick={() => context.open(node.tag)}
          className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
        >
          {hasChildren ? null : <SidebarIconSlot>{icon}</SidebarIconSlot>}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {tagDisplayName(node.name)}
          </span>
          <span className="shrink-0 pr-2.5 text-2xs tabular-nums text-text-muted transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
            {node.count}
          </span>
        </button>
        <button
          type="button"
          aria-label={`Configure #${node.tag}`}
          onClick={() => context.configure(node.tag)}
          className="absolute right-1.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-text-muted opacity-0 transition-[color,background-color,opacity] duration-150 ease-swift hover:bg-surface-active hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Settings aria-hidden className="size-3" />
        </button>
      </div>
      {isOpen ? (
        <ul className="mt-px flex flex-col space-y-px">
          {node.children.map((child) => (
            <TagRow key={child.key} node={child} depth={depth + 1} context={context} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
