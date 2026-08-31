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
import { SIDEBAR_SECTION_IDS, type SidebarSection } from '@reflect/core'
import { useSettings } from '@/providers/settings-provider'
import { SidebarOpenTabs } from './sidebar-open-notes'
import { SidebarPinned } from './sidebar-pinned'
import { SidebarTags } from './sidebar-tags'

/** Each shelf's component, keyed by the id the stored order is written in. */
const SECTION_COMPONENTS: Record<SidebarSection, () => ReactElement | null> = {
  open: SidebarOpenTabs,
  pinned: SidebarPinned,
  tags: SidebarTags,
}

/** The shelf a drag identifier names, or null when it names nothing known. */
function sectionForId(id: UniqueIdentifier): SidebarSection | null {
  return SIDEBAR_SECTION_IDS.find((section) => section === String(id)) ?? null
}

/**
 * The Home surface's shelves — Open, Pinned notes, Tags — stacked in the order
 * the user dragged them into. Each header is its own drag handle (see
 * {@link import('./sidebar-sortable-section').SidebarSortableSection}) and the
 * drop persists through the `sidebarSections` setting, so the arrangement
 * survives relaunch. The schema always hands back a complete list, so a shelf
 * introduced later simply appears at the bottom.
 */
export function SidebarSections(): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
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

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={settings.sidebarSections} strategy={verticalListSortingStrategy}>
        {settings.sidebarSections.map((id) => {
          const Section = SECTION_COMPONENTS[id]
          return <Section key={id} />
        })}
      </SortableContext>
    </DndContext>
  )
}
