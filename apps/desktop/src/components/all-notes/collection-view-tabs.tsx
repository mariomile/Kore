import type { KeyboardEvent, ReactElement } from 'react'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import type {
  CollectionPageView,
  CollectionViewMoveDirection,
  SavedCollectionView,
} from '@reflect/core'
import { Calendar, Close, LayoutGrid, LayoutTemplate, Layers, Plus } from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { sortableTranslateStyle } from '@/lib/sortable-translate'
import { cn } from '@/lib/utils'
import { collectionViewLabel } from './collection-view-model'

const VIEW_GLYPH = {
  table: Layers,
  board: LayoutTemplate,
  calendar: Calendar,
  grid: LayoutGrid,
} as const

const ADDABLE_VIEWS: readonly CollectionPageView[] = ['table', 'board', 'calendar', 'grid']

interface CollectionViewTabsProps {
  tabs: readonly SavedCollectionView[]
  activeViewId: string
  boardAvailable: boolean
  calendarAvailable: boolean
  onSelect: (view: SavedCollectionView) => void
  onAdd: (view: CollectionPageView) => void
  onDelete: (id: string) => void
  /** A dragged tab landed on `targetId`'s slot. */
  onMove: (id: string, targetId: string) => void
  /** Alt/Option+Arrow on a focused tab nudges it one slot. */
  onShift: (id: string, direction: CollectionViewMoveDirection) => void
}

function viewAvailable(
  view: CollectionPageView,
  boardAvailable: boolean,
  calendarAvailable: boolean,
): boolean {
  if (view === 'board') {
    return boardAvailable
  }
  if (view === 'calendar') {
    return calendarAvailable
  }
  return true
}

function unavailableReason(view: CollectionPageView): string {
  if (view === 'board') {
    return 'Add a select, status, or relation property first'
  }
  if (view === 'calendar') {
    return 'Add a date property first'
  }
  return ''
}

/**
 * Notion-style collection view tabs: the named lenses plus `+` to add
 * table / board / calendar / grid. The last remaining tab cannot be removed.
 * Tabs reorder by dragging (the pill is its own handle; the 4px activation
 * distance keeps a click a click) or with Alt/Option+Arrow on a focused tab.
 */
export function CollectionViewTabs({
  tabs,
  activeViewId,
  boardAvailable,
  calendarAvailable,
  onSelect,
  onAdd,
  onDelete,
  onMove,
  onShift,
}: CollectionViewTabsProps): ReactElement {
  const canDelete = tabs.length > 1
  const canReorder = tabs.length > 1
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const handleDragEnd = (event: DragEndEvent): void => {
    if (event.over !== null && event.over.id !== event.active.id) {
      onMove(String(event.active.id), String(event.over.id))
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
          <div
            role="tablist"
            aria-label="Collection views"
            className="flex min-w-0 items-center gap-0.5"
          >
            {tabs.map((tab) => (
              <CollectionViewTab
                key={tab.id}
                tab={tab}
                selected={tab.id === activeViewId}
                canDelete={canDelete}
                canReorder={canReorder}
                onSelect={onSelect}
                onDelete={onDelete}
                onShift={onShift}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Add a view"
              title="Add a view"
              className="app-icon-button text-text-muted hover:text-text"
            >
              <Plus aria-hidden className="size-3.5" />
            </button>
          }
        />
        <DropdownMenuContent align="start" sideOffset={6} className="min-w-44">
          {ADDABLE_VIEWS.map((pageView) => {
            const Glyph = VIEW_GLYPH[pageView]
            const available = viewAvailable(pageView, boardAvailable, calendarAvailable)
            return (
              <DropdownMenuItem
                key={pageView}
                disabled={!available}
                title={available ? undefined : unavailableReason(pageView)}
                onClick={() => {
                  onAdd(pageView)
                }}
              >
                <Glyph aria-hidden className="size-3.5" />
                {collectionViewLabel(pageView)}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

interface CollectionViewTabProps {
  tab: SavedCollectionView
  selected: boolean
  canDelete: boolean
  canReorder: boolean
  onSelect: (view: SavedCollectionView) => void
  onDelete: (id: string) => void
  onShift: (id: string, direction: CollectionViewMoveDirection) => void
}

function CollectionViewTab({
  tab,
  selected,
  canDelete,
  canReorder,
  onSelect,
  onDelete,
  onShift,
}: CollectionViewTabProps): ReactElement {
  const Glyph = VIEW_GLYPH[tab.view]
  // The pill itself is the handle; the delete button beside it stays out of
  // the drag so a press on the × never starts a move.
  const { isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: tab.id,
    disabled: !canReorder,
  })
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!canReorder || !event.altKey) {
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      onShift(tab.id, event.key === 'ArrowLeft' ? 'left' : 'right')
    }
  }
  return (
    <div
      ref={setNodeRef}
      style={sortableTranslateStyle(transform, transition)}
      className={cn('group/tab relative flex min-w-0', isDragging && 'z-10 opacity-70')}
    >
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={() => {
          onSelect(tab)
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex min-w-0 items-center gap-1.5 rounded-md py-1 text-sm transition-colors',
          canDelete ? 'pl-2 pr-6' : 'px-2',
          selected
            ? 'bg-surface-hover text-text'
            : 'text-text-muted hover:bg-surface-hover/60 hover:text-text-secondary',
        )}
        {...listeners}
      >
        <Glyph aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{tab.name}</span>
      </button>
      {canDelete ? (
        <button
          type="button"
          aria-label={`Delete view ${tab.name}`}
          onClick={(event) => {
            event.stopPropagation()
            onDelete(tab.id)
          }}
          className="absolute top-1/2 right-0.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-text-muted opacity-0 hover:text-text-secondary group-hover/tab:opacity-100 focus-visible:opacity-100"
        >
          <Close aria-hidden className="size-3" />
        </button>
      ) : null}
    </div>
  )
}
