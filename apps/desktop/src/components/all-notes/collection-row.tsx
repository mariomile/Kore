import { memo, type CSSProperties, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { displayNoteTitle, type CollectionEntry } from '@kore/core'
import { Check } from '@/components/icons'
import { formatRecencyLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useSettings } from '@/providers/settings-provider'
import { COLLECTION_GRID_CLASS } from './collection-grid'
import { CollectionTaskBadge } from './collection-task-badge'

interface CollectionRowProps {
  entry: CollectionEntry
  /** The table's shared data-driven column template. */
  gridStyle: CSSProperties
  /** Fixed pixel height synchronized with the virtualizer's `itemSize`. */
  rowHeight: number
  selected: boolean
  /** Open tasks belonging to this row's note (0 renders nothing). */
  openTasks: number
  /** Compact left selection gutter for embedded tables inside a note. */
  embedded: boolean
  /** Whether the Title column is frozen on horizontal scroll (`frozenColumns >= 1`). */
  titleFrozen: boolean
  /** Whether Title is the rightmost frozen column (`frozenColumns === 1`). */
  titleFrozenEdge: boolean
  /** Reserves the trailing "+" column cell so the grid stays aligned. */
  showAddColumn: boolean
  onSelect: (path: string, event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>) => void
  onToggle: (path: string, event: Pick<MouseEvent, 'shiftKey'>) => void
  onOpen: (path: string, event?: ModClickEvent) => void
  /** The typed property cells, in schema order. */
  children: ReactNode
}

/**
 * One note in a Collection table: a bordered Notion-style database row with
 * a sticky Title column, hover Open badge, left-gutter checkbox selection,
 * and schema-driven property cells.
 */
export const CollectionRow = memo(function CollectionRow({
  entry,
  gridStyle,
  rowHeight,
  selected,
  openTasks,
  embedded,
  titleFrozen,
  titleFrozenEdge,
  showAddColumn,
  onSelect,
  onToggle,
  onOpen,
  children,
}: CollectionRowProps): ReactElement {
  const { settings } = useSettings()
  return (
    <div
      data-note-path={entry.path}
      data-collection-row
      style={{ ...gridStyle, height: rowHeight }}
      onClick={(event) => {
        if (event.shiftKey) {
          event.preventDefault()
        }
        onSelect(entry.path, event)
      }}
      onDoubleClick={(event) => onOpen(entry.path, event)}
      className={cn(
        'group/row relative cursor-default select-none border-b border-border transition-colors duration-75',
        COLLECTION_GRID_CLASS,
        selected ? 'bg-accent-soft text-text' : 'bg-surface hover:bg-surface-hover/55',
      )}
    >
      <div
        style={titleFrozen ? { position: 'sticky', left: 0 } : undefined}
        className={cn(
          'relative flex h-full min-w-0 items-center border-r pr-2',
          titleFrozen ? 'z-10 bg-surface' : 'border-border',
          titleFrozenEdge ? 'collection-sticky-col border-border-strong/70' : 'border-border',
          embedded ? 'pl-8' : 'pl-12',
        )}
      >
        {titleFrozen ? (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 transition-colors duration-75',
              selected ? 'bg-accent-soft' : 'group-hover/row:bg-surface-hover/55',
            )}
          />
        ) : null}
        <button
          type="button"
          aria-label={selected ? 'Deselect note' : 'Select note'}
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(entry.path, event)
          }}
          className={cn(
            'group/check absolute inset-y-0 left-0 z-10 flex items-center justify-center transition-opacity duration-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none',
            embedded ? 'w-8' : 'w-12',
            selected ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'flex size-3.5 items-center justify-center rounded-[4px] border transition-colors',
              selected
                ? 'border-accent bg-accent-fill text-text-on-brand'
                : 'border-border-strong bg-surface group-hover/check:border-accent',
            )}
          >
            {selected ? <Check className="size-2.5" /> : null}
          </span>
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
            'relative z-10 flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] font-medium focus-visible:outline-none',
            selected ? 'text-accent' : 'text-text',
          )}
        >
          <span className="min-w-0 truncate">{displayNoteTitle(entry.title)}</span>
          {openTasks > 0 ? <CollectionTaskBadge count={openTasks} /> : null}
        </button>
        <span
          aria-hidden
          onClick={(event) => {
            event.stopPropagation()
            onOpen(entry.path, event)
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className="relative z-10 ml-1 shrink-0 cursor-pointer rounded-[4px] border border-border bg-surface px-1.5 py-0.5 text-[11px] font-medium leading-none text-text-secondary opacity-0 transition-opacity duration-100 hover:border-border-strong hover:text-text group-hover/row:opacity-100"
        >
          Open
        </span>
      </div>
      {children}
      <span className="flex h-full items-center justify-end whitespace-nowrap border-r border-border px-2.5 text-right text-[12px] tabular-nums text-text-muted">
        {entry.mtime > 0 ? formatRecencyLabel(entry.mtime, settings) : '—'}
      </span>
      {showAddColumn ? <span aria-hidden className="h-full" /> : null}
      <span aria-hidden className="h-full" />
    </div>
  )
})
