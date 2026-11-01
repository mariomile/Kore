import { useCallback, type ReactElement } from 'react'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { hasOwnFolders, SIDEBAR_SECTION_IDS, type SidebarSection } from '@reflect/core'
import { useFolderTree } from '@/hooks/use-folder-tree'
import { usePinnedNotes } from '@/hooks/use-pinned-notes'
import { useTagTree } from '@/hooks/use-tag-tree'
import { useGraph } from '@/providers/graph-provider'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import { SidebarFolders } from './sidebar-folders'
import { SidebarPinned } from './sidebar-pinned'
import { SidebarTags } from './sidebar-tags'

/** Each shelf's component, keyed by the id the stored order is written in. */
const SECTION_COMPONENTS: Record<SidebarSection, () => ReactElement | null> = {
  pinned: SidebarPinned,
  folders: SidebarFolders,
  tags: SidebarTags,
}

/** The shelf a drag identifier names, or null when it names nothing known. */
function sectionForId(id: UniqueIdentifier): SidebarSection | null {
  return SIDEBAR_SECTION_IDS.find((section) => section === String(id)) ?? null
}

/**
 * The Home surface's shelves — Pinned notes, Folders, Types — stacked in
 * the order the user dragged them into. Each header is its own drag handle (see
 * {@link import('./sidebar-sortable-section').SidebarSortableSection}) and the
 * drop persists through the `sidebarSections` setting, so the arrangement
 * survives relaunch. The schema always hands back a complete list, so a shelf
 * introduced later simply appears at the bottom.
 *
 * Every shelf is built from the index, so on a first open of a big vault all
 * of them are empty until the index lands, and then they would pop in one
 * under another. While the index is building and nothing has arrived yet,
 * a quiet placeholder holds their place instead, and the shelves fade in
 * together when it goes.
 */
export function SidebarSections(): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
  const { indexing } = useGraph()
  const folderTree = useFolderTree()
  const tagTree = useTagTree()
  const pinned = usePinnedNotes()
  const waitingForIndex =
    indexing &&
    pinned.length === 0 &&
    tagTree.length === 0 &&
    (folderTree === null || !hasOwnFolders(folderTree))
  // Same 4px activation distance as the pinned rows and the tab pills: a click
  // still toggles the section, and a drag only starts once the pointer travels.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const { active, over } = event
      if (over === null || active.id === over.id) {
        return
      }
      const dragged = sectionForId(active.id)
      const target = sectionForId(over.id)
      if (dragged === null || target === null) {
        return
      }
      updateSettingsWith((current) => {
        const from = current.sidebarSections.indexOf(dragged)
        const to = current.sidebarSections.indexOf(target)
        if (from === -1 || to === -1) {
          return {}
        }
        return { sidebarSections: arrayMove(current.sidebarSections, from, to) }
      })
    },
    [updateSettingsWith],
  )

  if (waitingForIndex) {
    return <ShelvesPlaceholder />
  }

  return (
    <div className="animate-in fade-in-0 duration-200 ease-swift motion-reduce:animate-none">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={settings.sidebarSections} strategy={verticalListSortingStrategy}>
          {settings.sidebarSections.map((id) => {
            const Section = SECTION_COMPONENTS[id]
            return <Section key={id} />
          })}
        </SortableContext>
      </DndContext>
    </div>
  )
}

/** Row widths for the placeholder, so it reads as a list rather than a block. */
const PLACEHOLDER_ROWS = ['w-16', 'w-32', 'w-24', 'w-28', 'w-20', 'w-16', 'w-28', 'w-24']

/**
 * What the shelves area shows while a first index is still building: a
 * section label and a few muted rows, the rough shape of Folders and Types.
 */
function ShelvesPlaceholder(): ReactElement {
  return (
    <div aria-hidden data-testid="sidebar-shelves-placeholder" className="mt-4 space-y-2 px-4">
      {PLACEHOLDER_ROWS.map((width, index) => (
        <div
          key={index}
          className={cn(
            'h-3 animate-pulse rounded bg-surface-hover motion-reduce:animate-none',
            index === 0 ? 'mb-3 h-2.5' : '',
            width,
          )}
        />
      ))}
    </div>
  )
}
