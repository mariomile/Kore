import type { ReactElement } from 'react'
import type { CollectionPageView, SavedCollectionView } from '@reflect/core'
import { Calendar, Close, LayoutGrid, LayoutTemplate, Layers, Plus } from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
 */
export function CollectionViewTabs({
  tabs,
  activeViewId,
  boardAvailable,
  calendarAvailable,
  onSelect,
  onAdd,
  onDelete,
}: CollectionViewTabsProps): ReactElement {
  const canDelete = tabs.length > 1

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <div
        role="tablist"
        aria-label="Collection views"
        className="flex min-w-0 items-center gap-0.5"
      >
        {tabs.map((tab) => {
          const Glyph = VIEW_GLYPH[tab.view]
          const selected = tab.id === activeViewId
          return (
            <div key={tab.id} className="group/tab relative flex min-w-0">
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  onSelect(tab)
                }}
                className={cn(
                  'flex min-w-0 items-center gap-1.5 rounded-md py-1 text-sm transition-colors',
                  canDelete ? 'pl-2 pr-6' : 'px-2',
                  selected
                    ? 'bg-surface-hover text-text'
                    : 'text-text-muted hover:bg-surface-hover/60 hover:text-text-secondary',
                )}
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
        })}
      </div>
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
