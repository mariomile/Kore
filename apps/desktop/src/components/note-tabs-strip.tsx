import type { OpenTab } from '@reflect/core'
import { useMemo, type MouseEvent, type ReactElement } from 'react'
import { useDndMonitor, type DragEndEvent } from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { Close, PanelLeft, PanelRight, Pin } from '@/components/icons'
import { TabContextMenu } from '@/components/note-tabs-context-menu'
import { NoteTabsListMenu } from '@/components/note-tabs-list-menu'
import { NoteTabsPlusMenu } from '@/components/note-tabs-plus-menu'
import { OpenTabIcon } from '@/components/open-tab-icon'
import { NavigateArrows } from '@/components/sidebar/navigate-arrows'
import { tabCloseClass, tabPillClass, useTabScrollIntoView } from '@/components/tab-pill'
import { useOpenTabItems, type OpenTabItem } from '@/hooks/use-open-tab-items'
import type { CommandContext } from '@/lib/commands/types'
import { sortableTranslateStyle } from '@/lib/sortable-translate'
import { resolveTabDrop } from '@/lib/tab-drop'
import { cn } from '@/lib/utils'
import { tabKey } from '@/providers/open-tab'
import { useOpenTabs } from '@/providers/open-tabs-provider'
import { useOptionalPanes, usePaneId } from '@/providers/panes-provider'
import { useSidebar } from '@/providers/sidebar-provider'

interface WorkspaceTabsStripProps {
  /** Commands for the "+" menu (new note vs the built-in browser). */
  commandContext?: CommandContext
  /**
   * Each rail toggle belongs to the one strip nearest its rail: the first
   * pane of the first column owns the sidebar toggle, the first pane of the
   * last column the context one. A lone strip keeps both.
   */
  showSidebarToggle?: boolean
  showContextToggle?: boolean
}

/**
 * The content column's browser-style tab bar. Every workspace page is a
 * closable tab; pinned tabs collapse to their semantic icon, and closing the
 * final tab falls back to Daily through the provider. Settings is a full-page
 * workspace and never joins the strip.
 *
 * Requires a `DndContext` above it: dragging a pill belongs to the workspace
 * frame's context (a pill travels between panes), and the `useDndMonitor`
 * this strip listens with throws without one. Anything mounting the strip on
 * its own, tests included, has to supply that context.
 */
export function WorkspaceTabsStrip({
  commandContext,
  showSidebarToggle = true,
  showContextToggle = true,
}: WorkspaceTabsStripProps): ReactElement {
  const { activeTab, activateTab, closeTab, togglePin, moveTab } = useOpenTabs()
  const items = useOpenTabItems()
  const { collapsed, toggleSidebar, contextCollapsed, toggleContextSidebar } = useSidebar()
  const activeKey = activeTab === null ? null : tabKey(activeTab)
  // An inactive column still shows which tab it is on, but quietly: only the
  // active pane's selected pill reads as selected. No panes (the note window,
  // tests) means the one strip is always the active one.
  const panes = useOptionalPanes()
  const paneId = usePaneId()
  const paneActive = panes === null || panes.activePane.id === paneId
  // Dragging is the frame's `DndContext` (one for the whole columns row, so a
  // pill can travel between panes); a drop that stayed inside this strip
  // comes back here as a reorder.
  useDndMonitor(
    useMemo(
      () => ({
        onDragEnd(event: DragEndEvent): void {
          const drop = resolveTabDrop(event.active, event.over)
          if (drop?.kind === 'reorder' && drop.paneId === paneId) {
            moveTab(drop.tab, drop.target)
          }
        },
      }),
      [paneId, moveTab],
    ),
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
        'app-window-chrome flex h-11 w-full flex-none items-center gap-1 bg-surface-sunken pl-1 pr-2.5',
      )}
    >
      <div className="window-drag-control flex items-center">
        {showSidebarToggle ? (
          <PanelToggle
            side="left"
            collapsed={collapsed}
            onToggle={toggleSidebar}
            label="Toggle sidebar"
          />
        ) : null}
        <NavigateArrows />
      </div>

      <div
        role="tablist"
        aria-label="Workspace tabs"
        className="window-drag-control ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        <TabContextMenu>
          <SortableContext
            items={items.map((item) => tabKey(item.tab))}
            strategy={horizontalListSortingStrategy}
          >
            {items.map((item) => (
              <StripTab
                key={tabKey(item.tab)}
                item={item}
                paneId={paneId}
                active={tabKey(item.tab) === activeKey}
                paneActive={paneActive}
                onActivate={activateTab}
                onClose={closeTab}
                onTogglePin={togglePin}
              />
            ))}
          </SortableContext>
        </TabContextMenu>

        {commandContext ? <NoteTabsPlusMenu context={commandContext} /> : null}
        <NoteTabsListMenu />
      </div>

      {showContextToggle ? (
        <div className="window-drag-control ml-auto flex items-center">
          <PanelToggle
            side="right"
            collapsed={contextCollapsed}
            onToggle={toggleContextSidebar}
            label="Toggle context panel"
          />
        </div>
      ) : null}
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
  /** The pane this strip belongs to: it travels with the drag payload. */
  paneId: string
  active: boolean
  /** False in a pane the user is not in: its selected pill stays muted. */
  paneActive: boolean
  onActivate: (tab: OpenTab) => void
  onClose: (tab: OpenTab) => void
  onTogglePin: (tab: OpenTab) => void
}

function StripTab({
  item,
  paneId,
  active,
  paneActive,
  onActivate,
  onClose,
  onTogglePin,
}: StripTabProps): ReactElement {
  const { tab, title } = item
  // The whole pill is the handle (the frame's activation distance keeps
  // clicks working). No overlay: the pill itself follows the pointer. The
  // payload says which pane and which tab, so a drop anywhere in the frame
  // resolves to a reorder here or a move into another pane.
  const { isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: tabKey(tab),
    data: { kind: 'tab', paneId, tab },
  })
  const scrollRef = useTabScrollIntoView(active)
  // One element, two owners: dnd-kit measures the pill, and the strip scrolls
  // the selected one back into view.
  const setTabRef = (element: HTMLElement | null): void => {
    setNodeRef(element)
    scrollRef.current = element
  }
  const sortableStyle = sortableTranslateStyle(transform, transition)
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
        data-tab-key={tabKey(tab)}
        onClick={() => {
          onActivate(tab)
        }}
        onDoubleClick={() => {
          onTogglePin(tab)
        }}
        onAuxClick={handleAuxClick}
        className={cn(
          tabPillClass(active),
          active && !paneActive && 'text-text-muted',
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
      data-tab-key={tabKey(tab)}
      onAuxClick={handleAuxClick}
      className={cn(
        tabPillClass(active),
        active && !paneActive && 'text-text-muted',
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
