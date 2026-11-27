import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { BASE_ADDABLE_VIEWS, type BaseDatabase, type BaseDefinition } from '@kore/core'
import { isModEvent } from '@meowdown/core'
import { AllNotesGrid, collectionGridNotes } from '@/components/all-notes/all-notes-grid'
import { CollectionBoard, tableGroupRows } from '@/components/all-notes/collection-board'
import { CollectionFilterMenu } from '@/components/all-notes/collection-filter-menu'
import { CollectionGroupMenu } from '@/components/all-notes/collection-group-menu'
import { CollectionTable } from '@/components/all-notes/collection-table'
import { CollectionViewTabs } from '@/components/all-notes/collection-view-tabs'
import { Check, Sliders } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { useListSelection } from '@/lib/selection/use-list-selection'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { cn } from '@/lib/utils'
import { routeForPath } from '@/routing/route'
import { useBaseDatabaseModel } from './use-base-database-model'

interface BaseDatabasePageProps {
  path: string
  definition: BaseDefinition
  database: BaseDatabase
}

/**
 * A base on the Mac as a database, with the type page's view bar: its views
 * as tabs (add, remove, reorder), grouping, filters and visible columns over
 * the table, board and card layouts. Every bar change is written into the
 * `.base` file, so Obsidian shows the same view; cells edit the notes' own
 * frontmatter. Rows and their order come from the base engine.
 */
export function BaseDatabasePage({
  path,
  definition,
  database,
}: BaseDatabasePageProps): ReactElement {
  const model = useBaseDatabaseModel(path, definition, database)
  const navigateNoteLink = useNoteLinkNavigation()
  const { view } = database
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [frozenColumns, setFrozenColumns] = useState(0)

  const openNote = useCallback(
    (target: string, event?: ModClickEvent) =>
      navigateNoteLink({
        target: routeForPath(target),
        openInSplit: event !== undefined && isModEvent(event),
      }),
    [navigateNoteLink],
  )
  const { groupedProperty } = model
  const groups =
    view.layout === 'table' && groupedProperty !== null
      ? tableGroupRows(view.entries, groupedProperty)
      : null
  const orderedPaths = useMemo(
    () =>
      groups === null
        ? view.entries.map((entry) => entry.path)
        : groups.flatMap((group) => group.entries.map((entry) => entry.path)),
    [groups, view.entries],
  )
  const selection = useListSelection(orderedPaths)

  return (
    <>
      <div className="flex flex-none flex-wrap items-center justify-between gap-3 pb-3 pl-12 pr-7">
        <CollectionViewTabs
          tabs={model.tabs}
          activeViewId={model.activeTabId}
          boardAvailable={model.boardProperties.length > 0}
          calendarAvailable={false}
          addableViews={BASE_ADDABLE_VIEWS}
          onSelect={model.selectTab}
          onAdd={model.addView}
          onDelete={model.deleteView}
          onMove={(id, targetId) => model.moveView(Number(id), Number(targetId))}
          onShift={(id, direction) =>
            model.moveView(Number(id), Number(id) + (direction === 'left' ? -1 : 1))
          }
        />
        <div className="flex flex-wrap items-center gap-1">
          {model.groupProperties.length > 0 ? (
            <CollectionGroupMenu
              properties={model.groupProperties}
              value={groupedProperty?.key ?? null}
              allowNone={view.layout !== 'board'}
              onChange={model.setGroup}
            />
          ) : null}
          <CollectionFilterMenu
            type={database.type}
            entries={database.entries}
            filters={view.filters.filters}
            onChange={(filters) =>
              model.edit({
                kind: 'filters',
                state: { ...view.filters, filters },
              })
            }
            match={view.filters.match}
            onMatchChange={(match) =>
              model.edit({ kind: 'filters', state: { ...view.filters, match } })
            }
          />
          {database.type.properties.length > 0 ? (
            <Popover>
              <PopoverTrigger
                aria-label="Columns"
                title="Visible properties"
                className="app-icon-button text-text-muted hover:text-text"
              >
                <Sliders aria-hidden className="size-3.5" />
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={4} className="w-56 p-1">
                <p className="px-2 pt-1 pb-0.5 text-2xs font-medium text-text-muted">
                  Visible properties
                </p>
                {database.type.properties.map((property) => {
                  const shown = !model.hiddenKeys.has(property.key)
                  return (
                    <button
                      key={property.key}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={shown}
                      onClick={() => model.toggleColumn(property.key)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-surface-hover"
                    >
                      <Check
                        aria-hidden
                        className={cn('size-3.5 shrink-0', shown ? 'opacity-100' : 'opacity-0')}
                      />
                      <span className="min-w-0 flex-1 truncate text-left">{property.name}</span>
                    </button>
                  )
                })}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div data-near-viewport-scroller className="h-full overflow-auto overscroll-x-none">
          {view.layout === 'grid' ? (
            <AllNotesGrid
              notes={collectionGridNotes(view.entries)}
              tag={null}
              type={model.visibleType}
              entries={view.entries}
              onOpen={openNote}
            />
          ) : view.layout === 'board' && groupedProperty !== null ? (
            <CollectionBoard
              entries={view.entries}
              tag=""
              type={database.type}
              property={groupedProperty}
              onCreateRow={model.createInLane}
              onOpen={openNote}
            />
          ) : (
            <CollectionTable
              entries={[...view.entries]}
              tag=""
              emptyLabel="No notes in this view."
              type={model.visibleType}
              editableKeys={database.editableKeys}
              selection={selection}
              sorts={view.sorts}
              onSortChange={model.setSorts}
              columnWidths={columnWidths}
              onColumnWidthChange={(key, rem) =>
                setColumnWidths((current) => ({ ...current, [key]: rem }))
              }
              frozenColumns={frozenColumns}
              onFrozenColumnsChange={setFrozenColumns}
              onHideColumn={model.toggleColumn}
              onCreateRow={model.createRow}
              groups={groups}
              onOpen={openNote}
              registerScrollToIndex={() => {}}
            />
          )}
        </div>
      </div>
    </>
  )
}
