import { createContext, use, useState, type ReactElement, type ReactNode } from 'react'
import type { DraggableSyntheticListeners } from '@dnd-kit/core'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Close,
  MoreHorizontal,
} from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * What the Details panel's arrangement lends one section: the header as drag
 * handle, and the menu's Move up / Move down / Hide. Provided per section by
 * {@link import('./details-sections').DetailsSections}; absent wherever a
 * section renders outside it (the Calendar panel's Events), which then keeps
 * a plain header.
 */
export interface DetailsSectionArrangement {
  handle: {
    ref: (element: HTMLElement | null) => void
    listeners: DraggableSyntheticListeners
  }
  canMoveUp: boolean
  canMoveDown: boolean
  move: (direction: 'up' | 'down') => void
  hide: () => void
}

export const DetailsSectionArrangementContext = createContext<DetailsSectionArrangement | null>(
  null,
)

/** A section-specific command in the header menu, above the arrangement ones. */
export interface SidebarSectionMenuItem {
  label: string
  onSelect: () => void
}

interface SidebarSectionProps {
  /** Session-storage key suffix persisting this section's open state. */
  storageKey: string
  title: string
  /** Commands of this section's own, listed first in the header menu. */
  menuItems?: readonly SidebarSectionMenuItem[]
  children: ReactNode
}

const STORAGE_PREFIX = 'reflect.context-sidebar.'

function readOpenState(storageKey: string): boolean {
  return window.sessionStorage.getItem(STORAGE_PREFIX + storageKey) !== 'closed'
}

const headerControlClass =
  'flex-none rounded text-text-muted transition-colors duration-100 hover:text-text-secondary'

/**
 * One collapsible sidebar section (the old app's `SidebarItem` shape): a
 * quiet sentence-case header whose disclosure chevron sits on the right and —
 * while the section is open — only appears on hover. Open by default,
 * open/closed state persisted per section for the session so a collapsed
 * section stays collapsed while navigating between days and notes.
 *
 * Inside the Details panel the header is also the drag handle (a click still
 * toggles: the drag starts only once the pointer travels), and a "…" menu on
 * hover carries the section's own commands plus Move up, Move down and Hide,
 * the keyboard path to the same arrangement.
 */
export function SidebarSection({
  storageKey,
  title,
  menuItems = [],
  children,
}: SidebarSectionProps): ReactElement {
  const [open, setOpen] = useState(() => readOpenState(storageKey))
  const [menuOpen, setMenuOpen] = useState(false)
  const arrangement = use(DetailsSectionArrangementContext)

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    window.sessionStorage.setItem(STORAGE_PREFIX + storageKey, next ? 'open' : 'closed')
  }

  const Chevron = open ? ChevronDown : ChevronRight
  const hasMenu = arrangement !== null || menuItems.length > 0
  return (
    <section aria-label={title} className="space-y-2">
      <div className="group flex items-center gap-1 px-3.5">
        <button
          type="button"
          ref={arrangement?.handle.ref}
          onClick={toggle}
          aria-expanded={open}
          className={cn(
            'flex min-w-0 flex-1 items-center text-2xs font-medium text-text-muted',
            arrangement && 'touch-none select-none',
          )}
          {...arrangement?.handle.listeners}
        >
          <span className="flex-1 truncate text-left">{title}</span>
          <span className={cn('flex-none group-hover:visible', open && 'invisible')}>
            <Chevron aria-hidden className="size-3" />
          </span>
        </button>
        {hasMenu ? (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`${title} options`}
                  title={`${title} options`}
                  // Hover-revealed like the chevron, but faded rather than
                  // `invisible` so Tab still reaches it (focus shows it), and
                  // kept up while its menu is open.
                  className={cn(
                    headerControlClass,
                    'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                    menuOpen && 'opacity-100',
                  )}
                >
                  <MoreHorizontal aria-hidden className="size-3.5" />
                </button>
              }
            />
            <DropdownMenuContent align="end" sideOffset={4} className="min-w-44">
              {menuItems.map((item) => (
                <DropdownMenuItem key={item.label} onClick={item.onSelect}>
                  {item.label}
                </DropdownMenuItem>
              ))}
              {arrangement !== null && menuItems.length > 0 ? <DropdownMenuSeparator /> : null}
              {arrangement === null ? null : (
                <>
                  <DropdownMenuItem
                    disabled={!arrangement.canMoveUp}
                    onClick={() => {
                      arrangement.move('up')
                    }}
                  >
                    <ArrowUp aria-hidden className="size-3.5" />
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!arrangement.canMoveDown}
                    onClick={() => {
                      arrangement.move('down')
                    }}
                  >
                    <ArrowDown aria-hidden className="size-3.5" />
                    Move down
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={arrangement.hide}>
                    <Close aria-hidden className="size-3.5" />
                    Hide section
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {open ? (
        // Craft's grouped-rows register (Plan 28 slice 4): the section body
        // is a soft raised container on the rail's sunken ground — the label
        // stays quiet chrome above it, rows keep their own hover wash inside.
        <div className="mx-2 rounded-xl border border-border/60 bg-surface p-1">{children}</div>
      ) : null}
    </section>
  )
}
