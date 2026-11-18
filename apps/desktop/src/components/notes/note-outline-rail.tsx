import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type CSSProperties,
  type RefObject,
} from 'react'
import { useDocumentOutline } from '@/hooks/use-document-outline'
import { cn } from '@/lib/utils'
import { useKeyboardVisible } from '@/mobile/use-keyboard'

/**
 * Indentation is relative to the shallowest heading present, capped so a
 * deeply nested run can't indent itself off the panel — the same rule the
 * context sidebar's outline section applies.
 */
const MAX_INDENT_STEPS = 3

interface NoteOutlineRailProps {
  /** The view holding the note, so the rail lists that note's headings only. */
  scope: RefObject<HTMLElement | null>
  /** Positioning: where the rail floats inside its relative parent. */
  className?: string
  /** Called as the jump list opens — the iPhone's light haptic. */
  onOpen?: () => void
}

/**
 * The floating, Notion-style outline beside an open note: a quiet stack of
 * dashes along the pane's right edge, one per section heading (longer dashes
 * are shallower sections, the darker one is the section on screen), that
 * expands into the jump list. The list marks the current section in the
 * text color and dims the rest; picking an entry scrolls its heading into
 * view and folds the list away.
 *
 * One component on both platforms. A mouse opens it on hover; a tap opens it
 * and a tap anywhere else closes it; the keyboard reaches it by focus. The
 * open state is explicit React state rather than a CSS `:hover` reveal: a
 * pointer-events-gated panel would need its own hover to stay open, which
 * collapses the moment a fast cursor skips the dashes. On the iPhone it
 * steps aside while the software keyboard is up, so it never sits over the
 * line being typed.
 *
 * It reads the rendered document through {@link useDocumentOutline}, so it
 * follows edits live, and renders nothing for a note without sections — a
 * short note keeps its margin clean.
 */
export function NoteOutlineRail({
  scope,
  className,
  onOpen,
}: NoteOutlineRailProps): ReactElement | null {
  const { entries, current, reveal } = useDocumentOutline({ scope, trackCurrent: true })
  const keyboardVisible = useKeyboardVisible()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const show = (): void => {
    if (!open) {
      onOpen?.()
    }
    setOpen(true)
  }

  // A tap outside folds the list (a mouse folds it by leaving), and Escape
  // folds it from anywhere.
  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: globalThis.PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (entries.length === 0 || keyboardVisible) {
    return null
  }

  const shallowest = Math.min(...entries.map((entry) => entry.level))
  const depthOf = (level: number): number => Math.min(level - shallowest, MAX_INDENT_STEPS)

  const closeUnlessInside = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false)
    }
  }
  // Hover is a mouse affordance: a touch fires an emulated enter on tap,
  // which must not race the tap's own open.
  const onPointerEnter = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse') {
      show()
    }
  }
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse') {
      setOpen(false)
    }
  }

  return (
    <div
      ref={rootRef}
      data-testid="note-outline-rail"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={show}
      onBlur={closeUnlessInside}
      className={cn('absolute top-1/2 z-10 -translate-y-1/2', className)}
    >
      {/* The collapsed dashes are a real button so the keyboard can reach
          the jump list too: focusing it opens the panel, and Tab moves on
          into the entries. On touch its padding is the hit area. */}
      <button
        type="button"
        aria-label="Show note outline"
        aria-expanded={open}
        onClick={show}
        className={cn(
          'flex max-h-[60vh] flex-col items-end gap-[7px] overflow-hidden px-2 py-3 transition-opacity duration-150 outline-none',
          'pointer-coarse:pr-1 pointer-coarse:pl-3',
          open && 'opacity-0',
        )}
      >
        {entries.map((entry) => (
          <span
            key={`${entry.index}-${entry.level}`}
            aria-hidden
            className={cn(
              'h-0.5 w-[calc(1.25rem-var(--depth)*0.25rem)] rounded-full transition-colors duration-150',
              // A phone's margin is a fraction of the Mac's: shorter dashes
              // keep the rail inside it instead of over the text.
              'pointer-coarse:w-[calc(0.875rem-var(--depth)*0.1875rem)]',
              entry.index === current ? 'bg-text-muted' : 'bg-border-strong',
            )}
            style={{ '--depth': depthOf(entry.level) } as CSSProperties}
          />
        ))}
      </button>
      {open ? (
        <nav
          aria-label="Note outline"
          className="absolute right-0 top-1/2 w-56 -translate-y-1/2 pointer-coarse:right-3 pointer-coarse:w-[min(17rem,calc(100vw-2rem))]"
        >
          <ul className="max-h-[60vh] overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface p-1.5 shadow-md pointer-coarse:rounded-2xl pointer-coarse:p-2">
            {entries.map((entry) => (
              <li key={`${entry.index}-${entry.text}`}>
                <button
                  type="button"
                  aria-current={entry.index === current ? 'location' : undefined}
                  onClick={() => {
                    reveal(entry.index)
                    setOpen(false)
                  }}
                  style={{ paddingLeft: `${0.5 + depthOf(entry.level) * 0.75}rem` }}
                  className={cn(
                    'block w-full truncate rounded-md py-1 pr-2 text-left text-[13px] transition-colors duration-100',
                    'hover:bg-surface-hover focus-visible:bg-surface-hover outline-none',
                    // Touch rows wrap to two lines rather than truncate, and
                    // are tall enough to hit without a magnifier.
                    'pointer-coarse:line-clamp-2 pointer-coarse:rounded-lg pointer-coarse:py-2 pointer-coarse:text-[15px] pointer-coarse:leading-snug pointer-coarse:whitespace-normal pointer-coarse:hover:bg-transparent pointer-coarse:active:bg-surface-hover',
                    entry.index === current ? 'font-semibold text-text' : 'text-text-secondary',
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
