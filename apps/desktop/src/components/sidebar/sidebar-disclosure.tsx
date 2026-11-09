import { useState, type ReactElement, type ReactNode } from 'react'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * Drag-to-reorder wiring for a shelf whose header doubles as its handle —
 * supplied by {@link import('./sidebar-sortable-section').SidebarSortableSection}.
 */
export interface SidebarDisclosureHandle {
  ref: (element: HTMLElement | null) => void
  listeners: DraggableSyntheticListeners
}

/** The header menu's arrangement commands, the keyboard path to a drag. */
export interface SidebarDisclosureArrangement {
  canMoveUp: boolean
  canMoveDown: boolean
  move: (direction: 'up' | 'down') => void
  hide: () => void
}

interface SidebarDisclosureProps {
  /** Session-storage key suffix persisting this section's open state. */
  storageKey: string
  title: string
  /** Accessible name for the wrapping region (often the same as `title`). */
  label: string
  /** Present while the shelf can be dragged into a new position. */
  handle?: SidebarDisclosureHandle
  /** Present when the header offers a "…" menu with Move up/down and Hide. */
  arrangement?: SidebarDisclosureArrangement | undefined
  children: ReactNode
}

const STORAGE_PREFIX = 'kore.workspace-sidebar.'

function readOpenState(storageKey: string): boolean {
  return window.sessionStorage.getItem(STORAGE_PREFIX + storageKey) !== 'closed'
}

/**
 * A collapsible left-rail section (Open, Pinned notes, Tags): a quiet
 * sentence-case header whose disclosure chevron sits on the right and — while
 * the section is open — only appears on hover. Open by default; open/closed
 * state is persisted for the session so a collapsed shelf stays collapsed
 * while navigating. Height animates through `grid-template-rows` so the body
 * slides rather than popping.
 *
 * The header is also the shelf's drag handle when a `handle` is passed: a
 * click still toggles, because the drag only starts once the pointer travels
 * (the same tuning as the pinned rows and the tab pills).
 */
export function SidebarDisclosure({
  storageKey,
  title,
  label,
  handle,
  arrangement,
  children,
}: SidebarDisclosureProps): ReactElement {
  const [open, setOpen] = useState(() => readOpenState(storageKey))
  const [menuOpen, setMenuOpen] = useState(false)

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    window.sessionStorage.setItem(STORAGE_PREFIX + storageKey, next ? 'open' : 'closed')
  }

  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section aria-label={label} className="px-4.5">
      <div className="group flex items-center gap-1 pt-4">
        <button
          type="button"
          ref={handle?.ref}
          onClick={toggle}
          aria-expanded={open}
          className={cn(
            'flex min-w-0 flex-1 items-center text-2xs font-medium leading-5 tracking-wide text-text-muted',
            handle && 'touch-none select-none',
          )}
          {...handle?.listeners}
        >
          <span className="min-w-0 flex-1 truncate text-left">{title}</span>
          <span className={cn('flex-none group-hover:visible', open && 'invisible')}>
            <Chevron aria-hidden className="size-3" />
          </span>
        </button>
        {arrangement === undefined ? null : (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`${title} options`}
                  title={`${title} options`}
                  // Faded rather than `invisible` so Tab still reaches it, and
                  // kept up while its menu is open.
                  className={cn(
                    'flex-none rounded text-text-muted opacity-0 transition-colors duration-100 hover:text-text-secondary group-hover:opacity-100 focus-visible:opacity-100',
                    menuOpen && 'opacity-100',
                  )}
                >
                  <MoreHorizontal aria-hidden className="size-3.5" />
                </button>
              }
            />
            <DropdownMenuContent align="end" sideOffset={4} className="min-w-44">
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
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </section>
  )
}
