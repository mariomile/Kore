import type { ReactElement } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Close,
  MoreHorizontal,
  Pin,
  PinOff,
  Settings,
  Trash,
} from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ColumnHeaderMenuProps {
  /** Column display name (Title or a schema property). */
  columnName: string
  /** `then` appends this key to the chain instead of starting a new one. */
  onSort: (direction: 'asc' | 'desc', then: boolean) => void
  /** Whether a chain exists to append to — "Then by" only shows when it does. */
  sorted: boolean
  /** True when this column is currently the rightmost frozen column. */
  isFrozenBoundary?: boolean
  /** Toggle freezing up to this column (or unfreezing when it is already the boundary). */
  onToggleFreeze?: (() => void) | undefined
  /** Absent where columns cannot hide (Title or an embedded fence). */
  onHide?: (() => void) | undefined
  onEditSchema?: (() => void) | undefined
  onDelete?: (() => Promise<void>) | undefined
}

/**
 * The per-column menu behind a header's "⋯": sort, freeze up to column,
 * hide, edit, delete — the column is the handle for its layout and property.
 */
export function ColumnHeaderMenu({
  columnName,
  onSort,
  sorted,
  isFrozenBoundary = false,
  onToggleFreeze,
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
            aria-label={`Column options for ${columnName}`}
            title="Column options"
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-muted opacity-0 transition-opacity hover:text-text-secondary focus-visible:opacity-100 group-hover/header:opacity-100 data-[popup-open]:opacity-100"
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
        {onToggleFreeze !== undefined ||
        onHide !== undefined ||
        onEditSchema !== undefined ||
        onDelete !== undefined ? (
          <DropdownMenuSeparator />
        ) : null}
        {onToggleFreeze === undefined ? null : (
          <DropdownMenuItem onClick={onToggleFreeze}>
            {isFrozenBoundary ? (
              <>
                <PinOff aria-hidden className="size-3.5" />
                Unfreeze columns
              </>
            ) : (
              <>
                <Pin aria-hidden className="size-3.5" />
                Freeze up to column
              </>
            )}
          </DropdownMenuItem>
        )}
        {onHide === undefined ? null : (
          <DropdownMenuItem onClick={onHide}>
            <Close aria-hidden className="size-3.5" />
            Hide column
          </DropdownMenuItem>
        )}
        {onEditSchema === undefined ? null : (
          <DropdownMenuItem onClick={onEditSchema}>
            <Settings aria-hidden className="size-3.5" />
            Edit property…
          </DropdownMenuItem>
        )}
        {onDelete === undefined ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void onDelete()}>
              <Trash aria-hidden className="size-3.5" />
              Delete property
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
