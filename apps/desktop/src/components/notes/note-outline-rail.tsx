import { useState, type FocusEvent, type ReactElement } from 'react'
import { useDocumentOutline } from '@/hooks/use-document-outline'
import { cn } from '@/lib/utils'

/**
 * Indentation is relative to the shallowest heading present, capped so a
 * deeply nested run can't indent itself off the panel — the same rule the
 * context sidebar's outline section applies.
 */
const MAX_INDENT_STEPS = 3

/**
 * The floating, Notion-style outline beside an open note: a quiet stack of
 * dashes along the pane's right edge, one per heading (longer dashes are
 * shallower sections), that expands into the jump list while hovered or
 * keyboard-focused. Clicking an entry scrolls its heading into view.
 *
 * The open state is explicit React state driven by enter/leave rather than a
 * CSS `:hover` reveal: a pointer-events-gated panel would need its own hover
 * to stay open, which collapses the moment a fast cursor skips the dashes.
 *
 * It reads the rendered document through {@link useDocumentOutline}, so it
 * follows edits live, and renders nothing for a note without headings — a
 * short note keeps its margin clean. The whole rail hides below `md`
 * viewports, where the margin it floats in doesn't exist.
 */
export function NoteOutlineRail(): ReactElement | null {
  const { entries, reveal } = useDocumentOutline()
  const [open, setOpen] = useState(false)

  if (entries.length === 0) {
    return null
  }

  const shallowest = Math.min(...entries.map((entry) => entry.level))
  const depthOf = (level: number): number => Math.min(level - shallowest, MAX_INDENT_STEPS)

  const closeUnlessInside = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false)
    }
  }

  return (
    <div
      data-testid="note-outline-rail"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={closeUnlessInside}
      className="absolute right-1.5 top-1/2 z-10 hidden -translate-y-1/2 md:block"
    >
      {/* The collapsed dashes are a real button so the keyboard can reach
          the jump list too: focusing it opens the panel, and Tab moves on
          into the entries. */}
      <button
        type="button"
        aria-label="Show note outline"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          'flex max-h-[60vh] flex-col items-end gap-[7px] overflow-hidden px-2 py-3 transition-opacity duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          open && 'opacity-0',
        )}
      >
        {entries.map((entry) => (
          <span
            key={`${entry.index}-${entry.level}`}
            aria-hidden
            className="h-0.5 rounded-full bg-border-strong"
            style={{ width: `${1.25 - depthOf(entry.level) * 0.25}rem` }}
          />
        ))}
      </button>
      {open ? (
        <nav aria-label="Note outline" className="absolute right-0 top-1/2 w-56 -translate-y-1/2">
          <ul className="max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-surface p-1.5 shadow-md">
            {entries.map((entry) => (
              <li key={`${entry.index}-${entry.text}`}>
                <button
                  type="button"
                  onClick={() => reveal(entry.index)}
                  style={{ paddingLeft: `${0.5 + depthOf(entry.level) * 0.75}rem` }}
                  className={cn(
                    'block w-full truncate rounded-md py-1 pr-2 text-left text-[13px] transition-colors duration-100',
                    'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                    entry.level === shallowest ? 'font-medium text-text' : 'text-text-secondary',
                  )}
                >
                  {entry.text === '' ? 'Untitled heading' : entry.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  )
}
