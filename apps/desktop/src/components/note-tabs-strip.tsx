import type { MouseEvent, ReactElement } from 'react'
import { Pencil, Pin, X } from 'lucide-react'
import { useOpenTabNotes, type OpenTabNote } from '@/hooks/use-open-tab-notes'
import { cn } from '@/lib/utils'
import { useOpenTabs } from '@/providers/open-tabs-provider'

/**
 * The tab strip over the note pane (design option A): Daily notes as the
 * fixed, unclosable tab zero, pinned tabs collapsed to an icon right after
 * it, then the open notes — active tab fused with the page below (its white
 * background rides over the strip's hairline). Hidden entirely while no
 * ordinary note is open: with just the Daily view there is nothing to switch
 * between, and chrome that does nothing is noise. Middle-click closes;
 * double-click toggles pin.
 */
export function NoteTabsStrip(): ReactElement | null {
  const { tabs, activePath, isDailyActive, activateTab, activateDaily, closeTab, togglePin } =
    useOpenTabs()
  const notes = useOpenTabNotes()

  if (tabs.length === 0) {
    return null
  }

  return (
    <div
      role="tablist"
      aria-label="Open notes"
      className="flex h-11 flex-none items-end gap-0.5 overflow-x-auto border-b border-border bg-surface-app px-2.5 pt-1.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={isDailyActive}
        onClick={activateDaily}
        className={tabClass(isDailyActive)}
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
    </div>
  )
}

function tabClass(active: boolean): string {
  return cn(
    'flex h-8 min-w-0 max-w-[11rem] shrink items-center gap-1.5 rounded-t-lg px-3 text-xs font-medium',
    active
      ? '-mb-px border border-b-0 border-border bg-surface pb-px font-semibold text-text'
      : 'text-text-secondary hover:bg-surface-hover',
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
        className={cn(tabClass(active), 'shrink-0 px-2.5')}
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
      className={cn(tabClass(active), 'group cursor-default pr-1.5')}
    >
      <button
        type="button"
        onClick={() => {
          onActivate(note.path)
        }}
        onDoubleClick={() => {
          onTogglePin(note.path)
        }}
        className="min-w-0 flex-1 truncate text-left"
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
          'flex size-4 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-active hover:text-text',
          active ? '' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
        )}
      >
        <X aria-hidden className="size-3" />
      </button>
    </div>
  )
}
