import type { MouseEvent, ReactElement } from 'react'
import { Close, PanelLeft, PanelRight, Pencil, Pin } from '@/components/icons'
import { NoteTabsPlusMenu } from '@/components/note-tabs-plus-menu'
import { NavigateArrows } from '@/components/sidebar/navigate-arrows'
import { useOpenTabNotes, type OpenTabNote } from '@/hooks/use-open-tab-notes'
import type { CommandContext } from '@/lib/commands/types'
import { hasMacosTitleBarOverlay } from '@/lib/window-chrome'
import { cn } from '@/lib/utils'
import { useOpenTabs } from '@/providers/open-tabs-provider'
import { useSidebar } from '@/providers/sidebar-provider'

interface NoteTabsStripProps {
  /**
   * True when the bar reaches the window's left edge (sidebar collapsed) —
   * only then does the macOS traffic-light inset apply. With the sidebar
   * open, the sidebar owns that corner and the bar starts beside it.
   */
  atWindowEdge?: boolean
  /** Commands for the "+" menu (new note vs the built-in browser). */
  commandContext?: CommandContext
}

/**
 * The content column's tab bar: history arrows on the left, then the open
 * notes as rounded pills, then a "+" that creates a note or opens the
 * built-in browser. Daily notes is the fixed, unclosable first pill; pinned
 * tabs collapse to an icon right after it (double-click pins); the rest close
 * on hover or middle-click. It spans only the column beside the full-height
 * sidebar — the note-pane card below provides the separation, so the bar
 * itself is borderless — and doubles as the window drag region, so it never
 * blinks away.
 */
export function NoteTabsStrip({
  atWindowEdge = false,
  commandContext,
}: NoteTabsStripProps): ReactElement {
  const { activePath, isDailyActive, activateTab, activateDaily, closeTab, togglePin } =
    useOpenTabs()
  const notes = useOpenTabNotes()
  const { collapsed, toggleSidebar, contextCollapsed, toggleContextSidebar } = useSidebar()

  return (
    <div
      data-tauri-drag-region
      className={cn(
        // `surface-sunken` matches the two rails flanking the bar — the whole
        // chrome band reads as one color in every theme (several themes tint
        // `surface-app` differently, which left the strip a mismatched stripe).
        'flex h-11 w-full flex-none items-center gap-1 bg-surface-sunken pr-2.5',
        // With the overlaid macOS title bar the traffic lights own the left
        // edge — but only when the bar actually reaches it. 4.5rem clears
        // the lights while keeping the toggles as far left as they can sit.
        hasMacosTitleBarOverlay && atWindowEdge ? 'pl-[4.5rem]' : 'pl-1',
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
        aria-label="Open notes"
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

        {notes.map((note) => (
          <NoteTab
            key={note.path}
            note={note}
            active={note.path === activePath}
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

interface NoteTabProps {
  note: OpenTabNote
  active: boolean
  onActivate: (path: string) => void
  onClose: (path: string) => void
  onTogglePin: (path: string) => void
}

function NoteTab({ note, active, onActivate, onClose, onTogglePin }: NoteTabProps): ReactElement {
  const handleAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) {
      event.preventDefault()
      onClose(note.path)
    }
  }
  if (note.pinned) {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={note.title}
        title={note.title}
        onClick={() => {
          onActivate(note.path)
        }}
        onDoubleClick={() => {
          onTogglePin(note.path)
        }}
        onAuxClick={handleAuxClick}
        className={cn(
          pillClass(active),
          'shrink-0 px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        )}
      >
        <Pin aria-hidden className="size-3 shrink-0" />
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
          onActivate(note.path)
        }}
        onDoubleClick={() => {
          onTogglePin(note.path)
        }}
        className="min-w-0 flex-1 truncate rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {note.title}
      </button>
      <button
        type="button"
        aria-label={`Close ${note.title}`}
        onClick={(event) => {
          event.stopPropagation()
          onClose(note.path)
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
