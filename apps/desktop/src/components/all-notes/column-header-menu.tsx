import type { ReactElement } from 'react'
import type { TagProperty } from '@reflect/core'
import { ArrowDown, ArrowUp, Close, MoreHorizontal, Settings, Trash } from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ColumnHeaderMenuProps {
  property: TagProperty
  /** `then` appends this key to the chain instead of starting a new one. */
  onSort: (direction: 'asc' | 'desc', then: boolean) => void
  /** Whether a chain exists to append to — "Then by" only shows when it does. */
  sorted: boolean
  /** Absent where columns cannot hide (the embedded fence). */
  onHide?: (() => void) | undefined
  onEditSchema: () => void
  onDelete: () => Promise<void>
}

/**
 * The per-column menu behind a header's "⋯": sort, hide, edit, delete — the
 * column is the handle for its property, so the schema dialog is one option
 * among the everyday ones rather than the only door.
 */
export function ColumnHeaderMenu({
  property,
  onSort,
  sorted,
  onHide,
  onEditSchema,
  onDelete,
}: ColumnHeaderMenuProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Column options for ${property.name}`}
            title="Column options"
            className="flex size-4 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:text-text-secondary focus-visible:opacity-100 group-hover/header:opacity-100 data-[popup-open]:opacity-100"
          >
            <MoreHorizontal aria-hidden className="size-3" />
          </button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={4} className="w-48">
        <DropdownMenuItem onClick={() => onSort('asc', false)}>
          <ArrowUp aria-hidden className="size-3.5" />
          Sort ascending
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSort('desc', false)}>
          <ArrowDown aria-hidden className="size-3.5" />
          Sort descending
        </DropdownMenuItem>
        {sorted ? (
          <>
            <DropdownMenuItem onClick={() => onSort('asc', true)}>
              <ArrowUp aria-hidden className="size-3.5" />
              Then by, ascending
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSort('desc', true)}>
              <ArrowDown aria-hidden className="size-3.5" />
              Then by, descending
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        {onHide === undefined ? null : (
          <DropdownMenuItem onClick={onHide}>
            <Close aria-hidden className="size-3.5" />
            Hide column
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onEditSchema}>
          <Settings aria-hidden className="size-3.5" />
          Edit property…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void onDelete()}>
          <Trash aria-hidden className="size-3.5" />
          Delete property
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
