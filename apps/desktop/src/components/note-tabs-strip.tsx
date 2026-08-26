import { noteFileStem, type OpenTab, type WorkspaceSurface } from '@reflect/core'
import { useMemo, type MouseEvent, type ReactElement } from 'react'
import {
  Close,
  Globe,
  PanelLeft,
  PanelRight,
  Pencil,
  Pin,
  Settings,
  type Icon,
} from '@/components/icons'
import { NoteTabsPlusMenu } from '@/components/note-tabs-plus-menu'
import { NavigateArrows } from '@/components/sidebar/navigate-arrows'
import { useOpenTabNotes } from '@/hooks/use-open-tab-notes'
import type { CommandContext } from '@/lib/commands/types'
import { cn } from '@/lib/utils'
import { SURFACE_TAB_LABEL, tabKey } from '@/providers/open-tab'
import { useOpenTabs } from '@/providers/open-tabs-provider'
import { useSidebar } from '@/providers/sidebar-provider'

interface NoteTabsStripProps {
  /** Commands for the "+" menu (new note vs the built-in browser). */
  commandContext?: CommandContext
}

const SURFACE_ICON: Record<WorkspaceSurface, Icon> = {
  settings: Settings,
  browser: Globe,
}

interface StripItem {
  tab: OpenTab
  title: string
}

/**
 * The content column's tab bar: history arrows on the left, then the open
 * notes and workspace screens as rounded pills, then a "+" that creates a
 * note or opens the built-in browser. Daily notes is the fixed, unclosable
 * first pill; pinned tabs collapse to an icon right after it (double-click
 * pins); the rest close on hover or middle-click. It spans only the column
 * beside the full-height sidebar — the note-pane card below provides the
 * separation, so the bar itself is borderless — and doubles as the window
 * drag region, so it never blinks away.
 */
export function NoteTabsStrip({ commandContext }: NoteTabsStripProps): ReactElement {
  const { tabs, activeTab, isDailyActive, activateTab, activateDaily, closeTab, togglePin } =
    useOpenTabs()
  const notes = useOpenTabNotes()
  const { collapsed, toggleSidebar, contextCollapsed, toggleContextSidebar } = useSidebar()
  const items = useMemo((): StripItem[] => {
    const titles = new Map(notes.map((note) => [note.path, note.title]))
    return tabs.map((tab) => ({
      tab,
      title:
        tab.kind === 'note'
          ? (titles.get(tab.path) ?? noteFileStem(tab.path))
          : SURFACE_TAB_LABEL[tab.surface],
    }))
  }, [tabs, notes])
  const activeKey = activeTab === null ? null : tabKey(activeTab)

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
        aria-label="Open tabs"
        className="window-drag-control ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        <button
          type="button"
          role="tab"
          aria-selected={isDailyActive}
          onClick={activateDaily}
          className={pillClass(isDailyActive)}
        >
          <Pencil aria-hidden className="size-3 shrink-0" />
          <span className="truncate">Daily notes</span>
        </button>

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

        {commandContext ? <NoteTabsPlusMenu context={commandContext} /> : null}
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
        'flex size-6 shrink-0 items-center justify-center rounded-md transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]',
        'hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:scale-[0.97]',
        collapsed ? 'text-text-muted' : 'text-text-secondary',
      )}
    >
      <Icon aria-hidden className="size-3.5" />
    </button>
  )
}

function pillClass(active: boolean): string {
  return cn(
    'flex h-7 min-w-0 max-w-[12rem] shrink items-center gap-1.5 rounded-lg px-3 text-xs font-medium',
    'transition-all duration-150 ease-swift active:scale-[0.97]',
    // The active tab is the raised white pill on the app-background band —
    // the same recipe as the context rail's active segment.
    active
      ? 'border border-border bg-surface text-text shadow-sm'
      : 'text-text-secondary hover:bg-surface-hover hover:text-text',
  )
}

interface StripTabProps {
  item: StripItem
  active: boolean
  onActivate: (tab: OpenTab) => void
  onClose: (tab: OpenTab) => void
  onTogglePin: (tab: OpenTab) => void
}

function StripTab({ item, active, onActivate, onClose, onTogglePin }: StripTabProps): ReactElement {
  const { tab, title } = item
  const handleAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) {
      event.preventDefault()
      onClose(tab)
    }
  }
  const PinnedIcon = tab.kind === 'surface' ? SURFACE_ICON[tab.surface] : Pin
  if (tab.pinned) {
    return (
      <button
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
          pillClass(active),
          'shrink-0 px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        )}
      >
        <PinnedIcon aria-hidden className="size-3 shrink-0" />
      </button>
    )
  }
  return (
    <div
      role="tab"
      aria-selected={active}
      onAuxClick={handleAuxClick}
      className={cn(pillClass(active), 'group cursor-default pr-1')}
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
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded text-text-muted transition-[color,background-color,opacity] duration-150 ease-swift hover:bg-surface-active hover:text-text',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          active ? '' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
        )}
      >
        <Close aria-hidden className="size-3" />
      </button>
    </div>
  )
}
