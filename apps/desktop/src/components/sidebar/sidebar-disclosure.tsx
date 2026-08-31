import { useState, type ReactElement, type ReactNode } from 'react'
import type { DraggableSyntheticListeners } from '@dnd-kit/core'
import { ChevronDown, ChevronRight } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * Drag-to-reorder wiring for a shelf whose header doubles as its handle —
 * supplied by {@link import('./sidebar-sortable-section').SidebarSortableSection}.
 */
export interface SidebarDisclosureHandle {
  ref: (element: HTMLElement | null) => void
  listeners: DraggableSyntheticListeners
}

interface SidebarDisclosureProps {
  /** Session-storage key suffix persisting this section's open state. */
  storageKey: string
  title: string
  /** Accessible name for the wrapping region (often the same as `title`). */
  label: string
  /** Present while the shelf can be dragged into a new position. */
  handle?: SidebarDisclosureHandle
  children: ReactNode
}

const STORAGE_PREFIX = 'reflect.workspace-sidebar.'

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
  children,
}: SidebarDisclosureProps): ReactElement {
  const [open, setOpen] = useState(() => readOpenState(storageKey))

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    window.sessionStorage.setItem(STORAGE_PREFIX + storageKey, next ? 'open' : 'closed')
  }

  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section aria-label={label} className="px-4.5">
      <button
        type="button"
        ref={handle?.ref}
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          'group flex w-full items-center pt-4 text-2xs font-medium leading-5 tracking-wide text-text-muted',
          handle && 'touch-none select-none',
        )}
        {...handle?.listeners}
      >
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        <span className={cn('flex-none group-hover:visible', open && 'invisible')}>
          <Chevron aria-hidden className="size-3" />
        </span>
      </button>
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
