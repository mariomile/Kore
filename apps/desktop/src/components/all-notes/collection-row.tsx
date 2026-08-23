import { memo, type CSSProperties, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import type { CollectionEntry } from '@reflect/core'
import { formatRecencyLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useSettings } from '@/providers/settings-provider'
import { COLLECTION_GRID_CLASS } from './collection-table'

interface CollectionRowProps {
  entry: CollectionEntry
  /** The table's shared data-driven column template. */
  gridStyle: CSSProperties
  selected: boolean
  onSelect: (path: string, event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>) => void
  onToggle: (path: string, event: Pick<MouseEvent, 'shiftKey'>) => void
  onOpen: (path: string, event?: ModClickEvent) => void
  /** The typed property cells, in schema order. */
  children: ReactNode
}

/**
 * One note in a Collection table: the All Notes row's selection contract
 * (body selects, gutter toggles, subject or double-click opens) around
 * schema-driven property cells.
 */
export const CollectionRow = memo(function CollectionRow({
  entry,
  gridStyle,
  selected,
  onSelect,
  onToggle,
  onOpen,
  children,
}: CollectionRowProps): ReactElement {
  const { settings } = useSettings()
  return (
    <div
      data-note-path={entry.path}
      style={gridStyle}
      onClick={(event) => {
        if (event.shiftKey) {
          event.preventDefault()
        }
        onSelect(entry.path, event)
      }}
      onDoubleClick={(event) => onOpen(entry.path, event)}
      className={cn(
        'group/row relative h-(--row-height) cursor-default select-none transition-colors duration-100',
        COLLECTION_GRID_CLASS,
        selected
          ? 'border-y border-accent/20 bg-accent-soft text-text dark:border-accent/10 dark:text-text'
          : 'shadow-[var(--border-hairline)] hover:bg-surface-hover',
      )}
    >
      <button
        type="button"
        aria-label={selected ? 'Deselect note' : 'Select note'}
        aria-pressed={selected}
        onClick={(event) => {
          event.stopPropagation()
          onToggle(entry.path, event)
        }}
        className={cn(
          'group absolute inset-y-0 left-0 flex w-12 items-center justify-center opacity-0 transition-opacity duration-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none',
          selected ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'size-2 rounded-full transition-transform duration-150 group-hover:scale-110',
            selected ? 'bg-accent' : 'ring-1 ring-accent',
          )}
        />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          if (event.detail > 1) {
            return
          }
          onOpen(entry.path, event)
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        className={cn(
          'truncate text-left text-[13px] font-medium focus-visible:outline-none',
          selected ? 'text-accent' : 'text-text',
        )}
      >
        {entry.title}
      </button>
      {children}
      <span className="whitespace-nowrap text-right text-[13px] tabular-nums text-text-secondary">
        {entry.mtime > 0 ? formatRecencyLabel(entry.mtime, settings) : '—'}
      </span>
    </div>
  )
})
