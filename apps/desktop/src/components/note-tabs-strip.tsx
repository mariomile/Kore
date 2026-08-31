import type { OpenTab } from '@reflect/core'
import { useCallback, type CSSProperties, type MouseEvent, type ReactElement } from 'react'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Close, PanelLeft, PanelRight, Pin } from '@/components/icons'
import { NoteTabsListMenu } from '@/components/note-tabs-list-menu'
import { NoteTabsPlusMenu } from '@/components/note-tabs-plus-menu'
import { OpenTabIcon } from '@/components/open-tab-icon'
import { NavigateArrows } from '@/components/sidebar/navigate-arrows'
import { tabCloseClass, tabPillClass, useTabScrollIntoView } from '@/components/tab-pill'
import { useOpenTabItems, type OpenTabItem } from '@/hooks/use-open-tab-items'
import type { CommandContext } from '@/lib/commands/types'
import { cn } from '@/lib/utils'
import { tabKey } from '@/providers/open-tab'
import { useOpenTabs } from '@/providers/open-tabs-provider'
import { useSidebar } from '@/providers/sidebar-provider'

interface WorkspaceTabsStripProps {
  /** Commands for the "+" menu (new note vs the built-in browser). */
  commandContext?: CommandContext
}

/**
 * The content column's browser-style tab bar. Every workspace page is a
 * closable tab; pinned tabs collapse to their semantic icon, and closing the
 * final tab falls back to Daily through the provider.
 */
export function WorkspaceTabsStrip({ commandContext }: WorkspaceTabsStripProps): ReactElement {
  const { activeTab, activateTab, closeTab, togglePin, moveTab } = useOpenTabs()
  const items = useOpenTabItems()
  const { collapsed, toggleSidebar, contextCollapsed, toggleContextSidebar } = useSidebar()
  const activeKey = activeTab === null ? null : tabKey(activeTab)
  // The 4px activation distance keeps plain clicks (activate), double clicks
  // (pin) and middle clicks (close) intact — a drag only starts once the
  // pointer actually travels. Same tuning as the sidebar's pinned shelf.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      if (event.over === null || event.active.id === event.over.id) {
        return
      }
      const dragged = items.find((item) => tabKey(item.tab) === String(event.active.id))
      const target = items.find((item) => tabKey(item.tab) === String(event.over?.id))
      if (dragged !== undefined && target !== undefined) {
        moveTab(dragged.tab, target.tab)
      }
    },
    [items, moveTab],
  )

  return (
    <div
      data-tauri-drag-region
      className={cn(
        // `surface-sunken` matches the two rails flanking the bar — the whole
        // chrome band reads as one color in every theme (several themes tint
        // `surface-app` differently, which left the strip a mismatched stripe).
        // The traffic lights ride their own band above the whole window
        // (see `WorkspaceContent`), so the bar keeps its left edge even with
        // the rail collapsed.
        'flex h-11 w-full flex-none items-center gap-1 bg-surface-sunken pl-1 pr-2.5',
      )}
    >
      <div className="window-drag-control flex items-center">
        <PanelToggle
          side="left"
          collapsed={collapsed}
          onToggle={toggleSidebar}
          label="Toggle sidebar"
        />
        <NavigateArrows />
      </div>

      <div
        role="tablist"
        aria-label="Workspace tabs"
        className="window-drag-control ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={items.map((item) => tabKey(item.tab))}
            strategy={horizontalListSortingStrategy}
          >
            {items.map((item) => (
              <StripTab
                key={tabKey(item.tab)}
                item={item}
                active={tabKey(item.tab) === activeKey}
                onActivate={activateTab}
                onClose={closeTab}
                onTogglePin={togglePin}
              />
            ))}
          </SortableContext>
        </DndContext>

        {commandContext ? <NoteTabsPlusMenu context={commandContext} /> : null}
        <NoteTabsListMenu />
      </div>

      <div className="window-drag-control ml-auto flex items-center">
        <PanelToggle
          side="right"
          collapsed={contextCollapsed}
          onToggle={toggleContextSidebar}
          label="Toggle context panel"
        />
      </div>
    </div>
  )
}

interface PanelToggleProps {
  side: 'left' | 'right'
  collapsed: boolean
  onToggle: () => void
  label: string
}

/**
 * The rail toggles bookending the bar — panel-left over the sidebar's
 * corner, panel-right over the context rail's. `aria-pressed` reports the
 * rail's visibility (pressed = shown), and the icon dims while its rail is
 * hidden so the bar itself tells the layout state at a glance.
 */
function PanelToggle({ side, collapsed, onToggle, label }: PanelToggleProps): ReactElement {
  const Icon = side === 'left' ? PanelLeft : PanelRight
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={!collapsed}
      onClick={onToggle}
      className={cn(
        'app-icon-button hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        collapsed ? 'text-text-muted' : 'text-text-secondary',
      )}
    >
      <Icon aria-hidden className="size-3.5" />
    </button>
  )
}

interface StripTabProps {
  item: OpenTabItem
  active: boolean
  onActivate: (tab: OpenTab) => void
  onClose: (tab: OpenTab) => void
  onTogglePin: (tab: OpenTab) => void
}

function StripTab({ item, active, onActivate, onClose, onTogglePin }: StripTabProps): ReactElement {
  const { tab, title } = item
  // Drag-to-reorder: the whole pill is the handle (activation distance keeps
  // clicks working); the drop lands in `moveTab` through the strip's
  // DndContext. No overlay — the pill itself follows the pointer.
  const { isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: tabKey(tab),
  })
  const scrollRef = useTabScrollIntoView(active)
  // One element, two owners: dnd-kit measures the pill, and the strip scrolls
  // the selected one back into view.
  const setTabRef = (element: HTMLElement | null): void => {
    setNodeRef(element)
    scrollRef.current = element
  }
  const sortableStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const handleAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) {
      event.preventDefault()
      onClose(tab)
    }
  }
  if (tab.pinned) {
    return (
      <button
        ref={setTabRef}
        style={sortableStyle}
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={title}
        title={title}
        onClick={() => {
          onActivate(tab)
        }}
        onDoubleClick={() => {
          onTogglePin(tab)
        }}
        onAuxClick={handleAuxClick}
        className={cn(
          tabPillClass(active),
          // A pinned tab is its icon: no label, so no room to hold open for one.
          'min-w-0 shrink-0 px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          isDragging && 'z-10 opacity-70',
        )}
        {...listeners}
      >
        {tab.kind === 'note' ? (
          <Pin aria-hidden className="size-3 shrink-0" />
        ) : (
          <OpenTabIcon tab={tab} className="size-3 shrink-0" />
        )}
      </button>
    )
  }
  return (
    <div
      ref={setTabRef}
      style={sortableStyle}
      role="tab"
      aria-selected={active}
      onAuxClick={handleAuxClick}
      className={cn(
        tabPillClass(active),
        'group cursor-default pr-1',
        isDragging && 'z-10 opacity-70',
      )}
      {...listeners}
    >
      <button
        type="button"
        onClick={() => {
          onActivate(tab)
        }}
        onDoubleClick={() => {
          onTogglePin(tab)
        }}
        className="min-w-0 flex-1 truncate rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {title}
      </button>
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={(event) => {
          event.stopPropagation()
          onClose(tab)
        }}
        className={tabCloseClass(active)}
      >
        <Close aria-hidden className="size-3" />
      </button>
    </div>
  )
}
