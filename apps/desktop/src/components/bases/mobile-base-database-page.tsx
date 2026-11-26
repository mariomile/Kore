import { useState, type ReactElement } from 'react'
import type { BaseDatabase, BaseDefinition } from '@kore/core'
import { Spinner } from '@/components/ui/spinner'
import { MobileBoard } from '@/mobile/collection/mobile-board'
import { MobileCollectionTable } from '@/mobile/collection/mobile-collection-table'
import { MobileGallery } from '@/mobile/collection/mobile-gallery'
import { mobileTypeView, type MobileTypeView } from '@/mobile/collection/mobile-type-view'
import { MobileViewBar } from '@/mobile/collection/mobile-view-bar'
import { MobileViewOptions, type ViewGrouping } from '@/mobile/collection/mobile-view-options'
import { MOBILE_VIEW_GLYPH, MobileViewsSheet } from '@/mobile/collection/mobile-views-sheet'
import { MobileScreenHeader } from '@/mobile/screen-header'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { useRouter } from '@/routing/router'
import { useBaseDatabaseModel } from './use-base-database-model'

type MobileBasePageProps =
  | {
      path: string
      name: string
      status: 'loading' | 'error'
      message?: string | undefined
    }
  | {
      path: string
      name: string
      status: 'ready'
      definition: BaseDefinition
      database: BaseDatabase
    }

/**
 * A base on the phone, shaped like a type's page: the stack's glass bar
 * with the base's name, its view pill and view options under it, and the
 * view as a table, a board or a gallery. The views sheet and the options
 * sheet write into the `.base` file, as the Mac's view bar does.
 */
export function MobileBaseDatabasePage(props: MobileBasePageProps): ReactElement {
  const { navigate, back, canBack } = useRouter()
  const onBack = (): void => (canBack ? back() : navigate({ kind: 'base', path: null, view: null }))
  return props.status === 'ready' ? (
    <ReadyBase {...props} onBack={onBack} />
  ) : (
    <PendingBase {...props} onBack={onBack} />
  )
}

/** The base while it loads, or why it couldn't open. */
function PendingBase({
  name,
  status,
  message,
  onBack,
}: {
  name: string
  status: 'loading' | 'error'
  message?: string | undefined
  onBack: () => void
}): ReactElement {
  // Each state measures its own bar: a remounted header needs a fresh reading.
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <MobileScreenHeader ref={barRef} title={name} onBack={onBack} />
      <div
        className="flex flex-1 items-center justify-center px-6 text-center"
        style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
      >
        {status === 'loading' ? (
          <Spinner aria-label="Loading base" className="size-5 text-text-muted" />
        ) : (
          <p role="alert" className="text-sm text-text-muted">
            Couldn’t open this base: {message}
          </p>
        )}
      </div>
    </div>
  )
}

function ReadyBase({
  path,
  name,
  definition,
  database,
  onBack,
}: {
  path: string
  name: string
  definition: BaseDefinition
  database: BaseDatabase
  onBack: () => void
}): ReactElement {
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  const model = useBaseDatabaseModel(path, definition, database)
  const { view } = database
  const [choosingView, setChoosingView] = useState(false)
  const [adjustingView, setAdjustingView] = useState(false)
  const layout = mobileTypeView(view.layout)
  const layouts: MobileTypeView[] =
    model.boardProperties.length > 0 ? ['table', 'board', 'gallery'] : ['table', 'gallery']
  const { groupedProperty } = model
  const grouping: ViewGrouping | null =
    model.groupProperties.length === 0
      ? null
      : {
          properties: model.groupProperties,
          selected: groupedProperty,
          allowNone: view.layout !== 'board',
          onChange: model.setGroup,
        }
  const filterCount = view.filters.filters.length

  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <MobileScreenHeader ref={barRef} title={name} onBack={onBack}>
        <MobileViewBar
          viewName={view.name}
          glyph={MOBILE_VIEW_GLYPH[layout]}
          filterCount={filterCount}
          lensActive={
            filterCount > 0 ||
            view.sorts.length > 0 ||
            (view.layout === 'table' && groupedProperty !== null)
          }
          onChooseView={() => setChoosingView(true)}
          onAdjustView={() => setAdjustingView(true)}
        />
      </MobileScreenHeader>
      {view.layout === 'board' && groupedProperty !== null ? (
        <MobileBoard
          entries={view.entries}
          tag=""
          type={database.type}
          property={groupedProperty}
          groupProperties={model.boardProperties}
          onGroupChange={model.setGroup}
          onCreateRow={model.createInLane}
          onOpen={model.openNote}
        />
      ) : view.layout === 'grid' ? (
        view.entries.length === 0 ? (
          <NoRows />
        ) : (
          <MobileGallery entries={view.entries} type={model.visibleType} onOpen={model.openNote} />
        )
      ) : (
        <MobileCollectionTable
          entries={view.entries}
          type={model.visibleType}
          groupProperty={groupedProperty}
          sorts={view.sorts}
          onSortChange={model.setSorts}
          label={name}
          onOpen={model.openNote}
          onCreate={model.createRow}
        />
      )}
      <MobileViewsSheet
        open={choosingView}
        onOpenChange={setChoosingView}
        tabs={model.tabs}
        activeTabId={model.activeTabId}
        layouts={layouts}
        onSelect={model.selectTab}
        onAdd={model.addView}
        onRename={model.renameView}
        onChangeLayout={model.changeLayout}
        onDelete={model.deleteView}
      />
      <MobileViewOptions
        open={adjustingView}
        onOpenChange={setAdjustingView}
        viewName={view.name}
        scope="base"
        layout={layout}
        type={database.type}
        entries={database.entries}
        filters={view.filters.filters}
        onFiltersChange={(filters) =>
          model.edit({ kind: 'filters', state: { ...view.filters, filters } })
        }
        match={view.filters.match}
        onMatchChange={(match) =>
          model.edit({ kind: 'filters', state: { ...view.filters, match } })
        }
        sorts={view.sorts}
        onSortsChange={model.setSorts}
        grouping={grouping}
        hiddenFields={model.hiddenKeys}
        onToggleField={model.toggleColumn}
      />
    </div>
  )
}

function NoRows(): ReactElement {
  return (
    <div
      className="flex flex-1 items-center justify-center px-6 text-center text-sm text-text-muted"
      style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
    >
      No notes in this view.
    </div>
  )
}
