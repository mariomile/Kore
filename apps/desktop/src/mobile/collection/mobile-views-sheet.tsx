import { useState, type FormEvent, type ReactElement } from 'react'
import type { CollectionPageView, SavedCollectionView } from '@kore/core'
import { LIVE_COLLECTION_VIEW_ID } from '@/components/all-notes/collection-view-model'
import {
  BoardView,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  TableView,
  TimelineView,
  type Icon,
} from '@/components/icons'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'
import { SettingsActionRow, SettingsGroup, SettingsSelectRow } from '@/mobile/settings-list'
import { mobileTypeView, storedTypeView, type MobileTypeView } from './mobile-type-view'

export const MOBILE_VIEW_GLYPH: Record<MobileTypeView, Icon> = {
  table: TableView,
  board: BoardView,
  calendar: Calendar,
  timeline: TimelineView,
  gallery: LayoutGrid,
}

export const MOBILE_VIEW_LABEL: Record<MobileTypeView, string> = {
  table: 'Table',
  board: 'Board',
  calendar: 'Calendar',
  timeline: 'Timeline',
  gallery: 'Grid',
}

const MOBILE_VIEW_DESCRIPTION: Record<MobileTypeView, string> = {
  table: 'Rows and columns like a spreadsheet',
  board: 'Kanban columns grouped by status',
  calendar: 'Notes arranged on a monthly calendar',
  timeline: 'Schedule bars across days and months',
  gallery: 'Visual cards with covers and tags',
}

interface MobileViewsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tabs: readonly SavedCollectionView[]
  activeTabId: string | undefined
  layouts: readonly MobileTypeView[]
  onSelect: (view: SavedCollectionView) => void
  onAdd: (view: CollectionPageView) => void
  onRename: (id: string, name: string) => void
  onChangeLayout: (id: string, view: CollectionPageView) => void
  onDelete: (id: string) => void
}

type SheetPage = { kind: 'root' } | { kind: 'new' } | { kind: 'edit'; id: string }

const ROOT: SheetPage = { kind: 'root' }

/**
 * Notion-style saved views sheet for a collection on iPhone: a grouped card
 * of the tag's own views (each with active checkmark and `...` to rename,
 * switch layout, or delete) plus a clear `+ New view` card that drills into
 * the layout picker instead of mixing existing views and creation actions.
 */
export function MobileViewsSheet({
  open,
  onOpenChange,
  tabs,
  activeTabId,
  layouts,
  onSelect,
  onAdd,
  onRename,
  onChangeLayout,
  onDelete,
}: MobileViewsSheetProps): ReactElement {
  const [page, setPage] = useState<SheetPage>(ROOT)
  const close = (): void => {
    onOpenChange(false)
    setPage(ROOT)
  }
  const go = (next: SheetPage): void => {
    setPage(next)
  }

  const editingView =
    page.kind === 'edit' ? (tabs.find((entry) => entry.id === page.id) ?? null) : null
  const effectivePage: SheetPage = page.kind === 'edit' && editingView === null ? ROOT : page

  const headerTitle =
    effectivePage.kind === 'root'
      ? `${tabs.length} ${tabs.length === 1 ? 'view' : 'views'}`
      : effectivePage.kind === 'new'
        ? 'New view'
        : (editingView?.name ?? 'Edit view')

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setPage(ROOT)
        }
      }}
    >
      <DrawerContent aria-label="Views">
        <div className="relative flex h-14 shrink-0 items-end justify-center px-16 pb-1">
          {effectivePage.kind === 'root' ? null : (
            <button
              type="button"
              aria-label="Back"
              onClick={() => go(ROOT)}
              className="absolute bottom-0 left-2 flex size-11 items-center justify-center rounded-full text-primary active:opacity-60"
            >
              <ChevronLeft aria-hidden className="size-5" />
            </button>
          )}
          <DrawerTitle className="truncate px-0 pt-0 pb-2.5 text-center text-[17px] font-semibold">
            {headerTitle}
          </DrawerTitle>
          <button
            type="button"
            onClick={close}
            className="absolute right-2 bottom-0 flex h-11 items-center rounded-full px-3 text-[15px] font-medium text-accent active:opacity-60"
          >
            Done
          </button>
        </div>

        <div className="flex max-h-[65dvh] min-h-[14rem] flex-col gap-5 overflow-y-auto px-4 pt-3 pb-8">
          {effectivePage.kind === 'root' ? (
            <>
              <SettingsGroup>
                <div role="listbox" aria-label="Saved views" className="divide-y divide-border">
                  {tabs.map((entry) => {
                    const Glyph = MOBILE_VIEW_GLYPH[mobileTypeView(entry.view)]
                    const selected = entry.id === activeTabId
                    const canManage = entry.id !== LIVE_COLLECTION_VIEW_ID
                    return (
                      <div key={entry.id} className="flex min-h-12 items-center">
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            haptic('selection')
                            onSelect(entry)
                            close()
                          }}
                          className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3.5 text-left text-[16px] text-text active:bg-surface-hover"
                        >
                          <Glyph aria-hidden className="size-[18px] shrink-0 text-text-muted" />
                          <span
                            className={cn('min-w-0 flex-1 truncate', selected && 'font-medium')}
                          >
                            {entry.name}
                          </span>
                          {selected ? (
                            <Check aria-hidden className="size-4 shrink-0 text-accent" />
                          ) : null}
                        </button>
                        {canManage ? (
                          <button
                            type="button"
                            aria-label={`Options for ${entry.name}`}
                            onClick={() => go({ kind: 'edit', id: entry.id })}
                            className="flex size-11 shrink-0 items-center justify-center text-text-muted active:bg-surface-hover active:text-text"
                          >
                            <MoreHorizontal aria-hidden className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </SettingsGroup>

              <SettingsGroup>
                <button
                  type="button"
                  onClick={() => go({ kind: 'new' })}
                  className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left active:bg-surface-hover"
                >
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-fill text-text-on-brand"
                  >
                    <Plus className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[16px] font-medium leading-snug text-text">New view</span>
                    <span className="truncate text-[13px] leading-snug text-text-muted">
                      {layouts.map((entry) => MOBILE_VIEW_LABEL[entry]).join(', ')}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
                </button>
              </SettingsGroup>
            </>
          ) : effectivePage.kind === 'new' ? (
            <SettingsGroup header="Choose a layout">
              {layouts.map((entry) => {
                const Glyph = MOBILE_VIEW_GLYPH[entry]
                return (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => {
                      haptic('selection')
                      onAdd(storedTypeView(entry))
                      close()
                    }}
                    className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left active:bg-surface-hover"
                  >
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-text-secondary"
                    >
                      <Glyph className="size-[18px]" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[16px] font-medium leading-snug text-text">
                        {MOBILE_VIEW_LABEL[entry]}
                      </span>
                      <span className="truncate text-[13px] leading-snug text-text-muted">
                        {MOBILE_VIEW_DESCRIPTION[entry]}
                      </span>
                    </span>
                  </button>
                )
              })}
            </SettingsGroup>
          ) : editingView !== null ? (
            <EditViewPage
              key={editingView.id}
              view={editingView}
              layouts={layouts}
              canDelete={tabs.length > 1}
              onRename={(nextName) => {
                onRename(editingView.id, nextName)
                go(ROOT)
              }}
              onChangeLayout={(nextLayout) => {
                haptic('selection')
                onChangeLayout(editingView.id, nextLayout)
              }}
              onDelete={() => {
                haptic('warning')
                onDelete(editingView.id)
                go(ROOT)
              }}
            />
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function EditViewPage({
  view,
  layouts,
  canDelete,
  onRename,
  onChangeLayout,
  onDelete,
}: {
  view: SavedCollectionView
  layouts: readonly MobileTypeView[]
  canDelete: boolean
  onRename: (name: string) => void
  onChangeLayout: (layout: CollectionPageView) => void
  onDelete: () => void
}): ReactElement {
  const [name, setName] = useState(view.name)
  const currentLayout = mobileTypeView(view.view)

  const submitName = (event: FormEvent): void => {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed !== '') {
      onRename(trimmed)
    }
  }

  return (
    <>
      <SettingsGroup header="Name">
        <form onSubmit={submitName} className="flex items-center gap-2 px-3 py-2">
          <input
            type="text"
            aria-label="View name"
            enterKeyHint="done"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="View name"
            className="h-10 min-w-0 flex-1 bg-transparent text-[16px] text-text outline-none placeholder:text-text-muted"
          />
          <button
            type="submit"
            disabled={name.trim() === '' || name.trim() === view.name}
            className="flex h-8 shrink-0 items-center rounded-full bg-accent-soft px-3 text-[13px] font-medium text-accent-soft-text disabled:opacity-40"
          >
            Save
          </button>
        </form>
      </SettingsGroup>

      <SettingsGroup header="Layout">
        {layouts.map((entry) => (
          <SettingsSelectRow
            key={entry}
            label={MOBILE_VIEW_LABEL[entry]}
            selected={currentLayout === entry}
            onPress={() => onChangeLayout(storedTypeView(entry))}
          />
        ))}
      </SettingsGroup>

      {canDelete ? (
        <SettingsGroup>
          <SettingsActionRow label="Delete view" tone="destructive" onPress={onDelete} />
        </SettingsGroup>
      ) : null}
    </>
  )
}
