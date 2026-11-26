import { useCallback, useMemo } from 'react'
import {
  addBaseView,
  BASE_VIEW_TYPES,
  baseColumnsToggled,
  baseSortOf,
  baseViewLayout,
  editBaseView,
  freeBaseViewName,
  moveBaseView,
  parseBaseFile,
  removeBaseView,
  type BaseDatabase,
  type BaseDefinition,
  type BaseViewEdit,
  type CollectionPageView,
  type CollectionSort,
  type SavedCollectionView,
  type TagProperty,
  type TagType,
} from '@kore/core'
import { groupableProperties } from '@/components/all-notes/collection-board'
import { groupablePropertiesOf } from '@/lib/tags/schema-views'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { useBaseFileEdit } from './use-base-file-edit'
import { useCreateBaseNote } from './use-create-base-note'

/** The title a note born in a board lane starts with. */
const LANE_NOTE_TITLE = 'Untitled'

/** The page layouts a base view can take, keyed for its Obsidian `type`. */
type BaseLayout = keyof typeof BASE_VIEW_TYPES

function isBaseLayout(layout: CollectionPageView): layout is BaseLayout {
  return layout in BASE_VIEW_TYPES
}

function defaultViewName(layout: BaseLayout): string {
  return layout === 'board' ? 'Board' : layout === 'grid' ? 'Cards' : 'Table'
}

/** One base database page's state and the `.base` writes its view bar makes. */
export interface BaseDatabaseModel {
  /** The base's views as the type page's tabs (id = view index). */
  readonly tabs: readonly SavedCollectionView[]
  readonly activeTabId: string
  /** The visible columns, in the view's order. */
  readonly visibleType: TagType
  /** Fields a board lanes by: note fields, pick lists before free text. */
  readonly boardProperties: readonly TagProperty[]
  /** Fields the current layout groups by (none for cards). */
  readonly groupProperties: readonly TagProperty[]
  readonly groupedProperty: TagProperty | null
  readonly hiddenKeys: ReadonlySet<string>
  readonly showView: (name: string | null) => void
  readonly openNote: (path: string) => void
  readonly selectTab: (tab: SavedCollectionView) => void
  readonly addView: (layout: CollectionPageView) => void
  readonly deleteView: (id: string) => void
  readonly moveView: (from: number, to: number) => void
  readonly renameView: (id: string, name: string) => void
  readonly changeLayout: (id: string, layout: CollectionPageView) => void
  readonly setGroup: (key: string | null) => void
  readonly setSorts: (sorts: readonly CollectionSort[]) => void
  readonly toggleColumn: (key: string) => void
  readonly edit: (change: BaseViewEdit) => void
  /** The table's "+ New": a note titled `title` the view implies. */
  readonly createRow: (title: string) => Promise<void>
  /** A board lane's "+": the view's prefill plus the lane's value. */
  readonly createInLane: (properties: Record<string, unknown>) => Promise<string | null>
}

/**
 * Everything the Mac and iPhone base pages share: the view tabs, the
 * fields the bar groups by, and every bar change as a `.base` edit
 * (`base-file-edit.ts`), so the two devices and Obsidian read one file.
 */
export function useBaseDatabaseModel(
  path: string,
  definition: BaseDefinition,
  database: BaseDatabase,
): BaseDatabaseModel {
  const { navigate } = useRouter()
  const write = useBaseFileEdit(path)
  const { view } = database
  const definitionView = definition.views[view.index] ?? null

  const showView = useCallback(
    (name: string | null) => navigate({ kind: 'base', path, view: name }),
    [navigate, path],
  )
  const openNote = useCallback((target: string) => navigate(routeForPath(target)), [navigate])
  const createTarget = useMemo(
    () => ({ definition, viewIndex: view.index }),
    [definition, view.index],
  )
  const createNote = useCreateBaseNote(createTarget, openNote)

  const visibleType = useMemo((): TagType => {
    const byKey = new Map(database.type.properties.map((property) => [property.key, property]))
    return {
      properties: view.columns.flatMap((key) => {
        const property = byKey.get(key)
        return property === undefined ? [] : [property]
      }),
    }
  }, [database.type, view.columns])
  const boardProperties = useMemo(() => {
    // A lane is a value a card moves to, so only note fields lane a board.
    const editable = groupableProperties(database.type, true).filter((property) =>
      database.editableKeys.has(property.key),
    )
    return [
      ...editable.filter((property) => property.type !== 'text'),
      ...editable.filter((property) => property.type === 'text'),
    ]
  }, [database.type, database.editableKeys])
  const groupProperties = useMemo(
    () =>
      view.layout === 'board'
        ? boardProperties
        : view.layout === 'table'
          ? groupablePropertiesOf(database.type.properties, true)
          : [],
    [view.layout, boardProperties, database.type],
  )
  const groupedProperty = groupProperties.find((property) => property.key === view.group) ?? null

  const edit = (change: BaseViewEdit): void => {
    void write((text) => editBaseView(text, view.index, change))
  }
  const laneFor = (layout: CollectionPageView): TagProperty | null =>
    layout === 'board' ? (groupedProperty ?? boardProperties[0] ?? null) : null

  return {
    tabs: definition.views.map(
      (entry, index): SavedCollectionView => ({
        id: String(index),
        name: entry.name,
        view: baseViewLayout(entry),
        sorts: [],
        group: null,
        match: 'all',
        tableGroup: null,
        filters: [],
      }),
    ),
    activeTabId: String(view.index),
    visibleType,
    boardProperties,
    groupProperties,
    groupedProperty,
    hiddenKeys: new Set(
      database.type.properties
        .map((property) => property.key)
        .filter((key) => !view.columns.includes(key)),
    ),
    showView,
    openNote,
    selectTab: (tab) => {
      if (tab.id !== String(view.index)) {
        showView(tab.name)
      }
    },
    addView: (layout) => {
      if (!isBaseLayout(layout)) {
        return
      }
      const name = freeBaseViewName(definition.views, defaultViewName(layout))
      const lane = laneFor(layout)
      void write((text) => {
        const added = addBaseView(text, {
          type: BASE_VIEW_TYPES[layout],
          name,
          ...(definitionView === null ? {} : { from: definitionView }),
        })
        if (lane === null) {
          return added
        }
        const index = parseBaseFile(added).views.length - 1
        return editBaseView(added, index, {
          kind: 'group',
          property: lane.key,
        })
      }).then((saved) => {
        if (saved) {
          showView(name)
        }
      })
    },
    deleteView: (id) => {
      const index = Number(id)
      void write((text) => removeBaseView(text, index)).then((saved) => {
        if (saved && index === view.index) {
          showView(null)
        }
      })
    },
    moveView: (from, to) => {
      if (from !== to && to >= 0 && to < definition.views.length) {
        void write((text) => moveBaseView(text, from, to))
      }
    },
    renameView: (id, name) => {
      const trimmed = name.trim()
      if (trimmed === '') {
        return
      }
      const wanted = freeBaseViewName(
        definition.views.filter((_, index) => String(index) !== id),
        trimmed,
      )
      void write((text) => editBaseView(text, Number(id), { kind: 'name', name: wanted })).then(
        (saved) => {
          if (saved && id === String(view.index)) {
            showView(wanted)
          }
        },
      )
    },
    changeLayout: (id, layout) => {
      if (!isBaseLayout(layout)) {
        return
      }
      const lane = laneFor(layout)
      const target = definition.views[Number(id)]
      void write((text) => {
        const typed = editBaseView(text, Number(id), {
          kind: 'type',
          type: BASE_VIEW_TYPES[layout],
        })
        // A board needs lanes: keep the view's grouping, else take the first field.
        return lane === null || (target?.groupBy ?? null) !== null
          ? typed
          : editBaseView(typed, Number(id), {
              kind: 'group',
              property: lane.key,
            })
      })
    },
    setGroup: (key) => {
      if (key !== null || view.layout !== 'board') {
        edit({ kind: 'group', property: key })
      }
    },
    setSorts: (sorts) => edit({ kind: 'sort', sort: baseSortOf(sorts) }),
    toggleColumn: (key) => {
      if (definitionView !== null) {
        edit({
          kind: 'columns',
          order: baseColumnsToggled(definitionView, key),
        })
      }
    },
    edit,
    createRow: async (title) => {
      await createNote(title, view.newNote)
    },
    createInLane: async (properties) => {
      const lane: Record<string, string | number | boolean> = {}
      for (const [key, value] of Object.entries(properties)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          lane[key] = value
        }
      }
      return await createNote(LANE_NOTE_TITLE, {
        ...view.newNote,
        properties: { ...view.newNote.properties, ...lane },
      })
    },
  }
}
