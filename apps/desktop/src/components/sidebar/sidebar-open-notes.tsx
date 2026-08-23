import type { ReactElement } from 'react'
import { Close, Note, Pin } from '@/components/icons'
import { useOpenTabNotes } from '@/hooks/use-open-tab-notes'
import { cn } from '@/lib/utils'
import { useOpenTabs } from '@/providers/open-tabs-provider'

/**
 * The sidebar's Open section (design option B): the same open-note tabs as
 * the strip, as rows above Pinned. The active note carries the selection
 * tint; the close affordance reveals on hover. Hidden while nothing is open
 * — an empty shelf is sidebar noise. The Daily view keeps its own nav row
 * above, so it never repeats here.
 */
export function SidebarOpenNotes(): ReactElement | null {
  const { activePath, activateTab, closeTab } = useOpenTabs()
  const notes = useOpenTabNotes()

  if (notes.length === 0) {
    return null
  }

  return (
    <div className="mt-6 px-2">
      <h2 className="pt-4 text-2xs font-medium leading-5 tracking-wide text-text-muted">Open</h2>
      <ul className="mt-1 space-y-0.5">
        {notes.map((note) => (
          <li key={note.path} className="group relative">
            <button
              type="button"
              onClick={() => {
                activateTab(note.path)
              }}
              className={cn(
                'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 pr-7 text-left text-xs',
                note.path === activePath
                  ? 'bg-surface-active font-medium text-text'
                  : 'text-text-secondary hover:bg-surface-hover',
              )}
            >
              {note.pinned ? (
                <Pin aria-hidden className="size-3.5 shrink-0 text-text-muted" />
              ) : (
                <Note aria-hidden className="size-3.5 shrink-0 text-text-muted" />
              )}
              <span className="min-w-0 truncate">{note.title}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${note.title}`}
              onClick={() => {
                closeTab(note.path)
              }}
              className="absolute right-1.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded text-text-muted opacity-0 transition-[color,background-color,opacity] duration-150 ease-swift hover:bg-surface-active hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Close aria-hidden className="size-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
