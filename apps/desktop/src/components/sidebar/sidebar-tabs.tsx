import { memo, useCallback, type ReactElement } from 'react'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { OpenTab } from '@kore/core'
import { Close, Plus } from '@/components/icons'
import { TabContextMenu } from '@/components/note-tabs-context-menu'
import { OpenTabIcon } from '@/components/open-tab-icon'
import { closeOnMiddleClick, tabCloseClass } from '@/components/tab-pill'
import { useOpenTabItems, type OpenTabItem } from '@/hooks/use-open-tab-items'
import { runCommand } from '@/lib/commands/registry'
import type { CommandContext } from '@/lib/commands/types'
import { sortableTranslateStyle } from '@/lib/sortable-translate'
import { cn } from '@/lib/utils'
import { tabKey } from '@/providers/open-tab'
import { useOpenTabs } from '@/providers/open-tabs-provider'
import { SidebarDisclosure } from './sidebar-disclosure'
import { SidebarIconSlot } from './sidebar-icon-slot'
import { SIDEBAR_TREE_ITEM_CLASS, sidebarRowState, sidebarTreePadding } from './sidebar-row-style'

interface SidebarTabsProps {
  /** Runs "New tab" (a new note), the same command as the strip's "+". */
  context: CommandContext
}

/**
 * The open tabs as a sidebar shelf, Folio-style, when the "Tabs in sidebar"
 * setting moves them out of the strip (see `useTabsInSidebar`). The rows are
 * the active pane's tabs in strip order: click opens, the × on hover closes
 * (the selected one keeps it, pinned tabs have none, as in the strip), dragging reorders and the right
 * click is the strip's own tab menu. A fixed shelf above the reorderable
 * ones, so it has no "…" menu: the setting is its only switch.
 */
export function SidebarTabs({ context }: SidebarTabsProps): ReactElement {
  const { activeTab, activateTab, closeTab, moveTab } = useOpenTabs()
  const items = useOpenTabItems()
  const activeKey = activeTab === null ? null : tabKey(activeTab)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const from = items.find((item) => tabKey(item.tab) === event.active.id)
      const to = items.find((item) => tabKey(item.tab) === event.over?.id)
      if (from !== undefined && to !== undefined && from !== to) {
        moveTab(from.tab, to.tab)
      }
    },
    [items, moveTab],
  )

  return (
    <SidebarDisclosure storageKey="tabs" title="Tabs" label="Tabs">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={items.map((item) => tabKey(item.tab))}
          strategy={verticalListSortingStrategy}
        >
          <TabContextMenu>
            <ul className="mt-2 flex flex-col space-y-px">
              {items.map((item) => (
                <SidebarTabRow
                  key={tabKey(item.tab)}
                  item={item}
                  active={tabKey(item.tab) === activeKey}
                  onActivate={activateTab}
                  onClose={closeTab}
                />
              ))}
            </ul>
          </TabContextMenu>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={() => {
          void runCommand('note.new', context)
        }}
        className={cn(SIDEBAR_TREE_ITEM_CLASS, 'mt-px', sidebarRowState(false), 'text-text-muted')}
        style={{ paddingLeft: sidebarTreePadding(0) }}
      >
        <SidebarIconSlot>
          <Plus className="size-3.5" />
        </SidebarIconSlot>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">New tab</span>
      </button>
    </SidebarDisclosure>
  )
}

interface SidebarTabRowProps {
  item: OpenTabItem
  active: boolean
  onActivate: (tab: OpenTab) => void
  onClose: (tab: OpenTab) => void
}

const SidebarTabRow = memo(function SidebarTabRow({
  item,
  active,
  onActivate,
  onClose,
}: SidebarTabRowProps): ReactElement {
  const { tab, title } = item
  const { isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: tabKey(tab),
  })
  return (
    <li
      ref={setNodeRef}
      style={sortableTranslateStyle(transform, transition)}
      data-tab-key={tabKey(tab)}
      className={cn('group relative touch-none', isDragging && 'z-10 opacity-70')}
      onAuxClick={closeOnMiddleClick(() => {
        onClose(tab)
      })}
      {...listeners}
    >
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        title={title}
        onClick={() => {
          onActivate(tab)
        }}
        className={cn(SIDEBAR_TREE_ITEM_CLASS, sidebarRowState(active), !tab.pinned && 'pr-8')}
        style={{ paddingLeft: sidebarTreePadding(0) }}
      >
        <SidebarIconSlot>
          <OpenTabIcon tab={tab} className={cn('size-3.5', active && 'text-accent')} />
        </SidebarIconSlot>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
      </button>
      {tab.pinned ? null : (
        <button
          type="button"
          aria-label={`Close ${title}`}
          onClick={() => {
            onClose(tab)
          }}
          className={cn(tabCloseClass(active), 'absolute top-1/2 right-2 -translate-y-1/2')}
        >
          <Close aria-hidden className="size-3" />
        </button>
      )}
    </li>
  )
})
