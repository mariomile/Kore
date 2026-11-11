import { useCallback, useMemo, type ReactElement, type ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { DETAILS_SECTION_IDS, moveDetailsSection, type DetailsSection } from '@kore/core'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { sortableTranslateStyle } from '@/lib/sortable-translate'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import { DetailsSectionArrangementContext } from './sidebar-section'

/** One section a route's Details panel can show. */
export interface DetailsSectionEntry {
  id: DetailsSection
  /** Its name in the "Hidden" menu (the section's own header title). */
  title: string
  node: ReactNode
}

interface DetailsSectionsProps {
  /** Every section this route has, whatever the stored order says. */
  sections: readonly DetailsSectionEntry[]
}

function sectionForId(id: unknown): DetailsSection | null {
  return DETAILS_SECTION_IDS.find((section) => section === String(id)) ?? null
}

/**
 * The Details panel's sections in the user's arrangement: dragged by their
 * header into any order, moved or hidden from their "…" menu, and brought
 * back from the quiet "Hidden" menu at the bottom. The arrangement lives in
 * the `detailsSections` / `hiddenDetailsSections` settings, so it survives
 * relaunch and is shared by every note and day (a route shows the subset it
 * has, in that order).
 *
 * A section that hides itself while empty (an outline with no headings)
 * still holds its place in the order; its wrapper is a flex item with
 * nothing in it, so the column's gap skips it.
 */
export function DetailsSections({ sections }: DetailsSectionsProps): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const present = useMemo(() => sections.map((section) => section.id), [sections])
  const byId = useMemo(() => new Map(sections.map((section) => [section.id, section])), [sections])
  const hidden = settings.hiddenDetailsSections
  const visible = settings.detailsSections.filter((id) => byId.has(id) && !hidden.includes(id))
  const hiddenHere = sections.filter((section) => hidden.includes(section.id))

  const move = useCallback(
    (id: DetailsSection, direction: 'up' | 'down'): void => {
      updateSettingsWith((current) => ({
        detailsSections: moveDetailsSection(
          current.detailsSections,
          present.filter((entry) => !current.hiddenDetailsSections.includes(entry)),
          id,
          direction,
        ),
      }))
    },
    [present, updateSettingsWith],
  )

  const setHidden = useCallback(
    (id: DetailsSection, hide: boolean): void => {
      updateSettingsWith((current) => ({
        hiddenDetailsSections: hide
          ? [...current.hiddenDetailsSections.filter((entry) => entry !== id), id]
          : current.hiddenDetailsSections.filter((entry) => entry !== id),
      }))
    },
    [updateSettingsWith],
  )

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
        const from = current.detailsSections.indexOf(dragged)
        const to = current.detailsSections.indexOf(target)
        return from === -1 || to === -1
          ? {}
          : { detailsSections: arrayMove(current.detailsSections, from, to) }
      })
    },
    [updateSettingsWith],
  )

  return (
    <div className="flex flex-col gap-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visible} strategy={verticalListSortingStrategy}>
          {visible.map((id, index) => (
            <SortableDetailsSection
              key={id}
              id={id}
              canMoveUp={index > 0}
              canMoveDown={index < visible.length - 1}
              onMove={move}
              onSetHidden={setHidden}
            >
              {byId.get(id)?.node}
            </SortableDetailsSection>
          ))}
        </SortableContext>
      </DndContext>
      {hiddenHere.length === 0 ? null : (
        <HiddenSectionsMenu
          sections={hiddenHere}
          onShow={(id) => {
            setHidden(id, false)
          }}
        />
      )}
    </div>
  )
}

interface SortableDetailsSectionProps {
  id: DetailsSection
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (id: DetailsSection, direction: 'up' | 'down') => void
  onSetHidden: (id: DetailsSection, hide: boolean) => void
  children: ReactNode
}

function SortableDetailsSection({
  id,
  canMoveUp,
  canMoveDown,
  onMove,
  onSetHidden,
  children,
}: SortableDetailsSectionProps): ReactElement {
  const { isDragging, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id })
  const arrangement = useMemo(
    () => ({
      handle: { ref: setActivatorNodeRef, listeners },
      canMoveUp,
      canMoveDown,
      move: (direction: 'up' | 'down') => {
        onMove(id, direction)
      },
      hide: () => {
        onSetHidden(id, true)
      },
    }),
    [setActivatorNodeRef, listeners, canMoveUp, canMoveDown, onMove, onSetHidden, id],
  )
  return (
    <div
      ref={setNodeRef}
      data-details-section={id}
      style={sortableTranslateStyle(transform, transition)}
      // An empty wrapper (a section that renders nothing) leaves the flow, so
      // the column's gap does not open around it.
      className={cn('empty:hidden', isDragging && 'relative z-10 opacity-70')}
    >
      <DetailsSectionArrangementContext value={arrangement}>
        {children}
      </DetailsSectionArrangementContext>
    </div>
  )
}

interface HiddenSectionsMenuProps {
  sections: readonly DetailsSectionEntry[]
  onShow: (id: DetailsSection) => void
}

/** The way back for hidden sections: a quiet footer line with a menu of them. */
function HiddenSectionsMenu({ sections, onShow }: HiddenSectionsMenuProps): ReactElement {
  return (
    <div className="px-3.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="rounded text-2xs font-medium text-text-muted transition-colors duration-100 hover:text-text-secondary"
            >
              {sections.length === 1 ? '1 hidden section' : `${sections.length} hidden sections`}
            </button>
          }
        />
        <DropdownMenuContent align="start" sideOffset={4} className="min-w-44">
          {sections.map((section) => (
            <DropdownMenuItem
              key={section.id}
              onClick={() => {
                onShow(section.id)
              }}
            >
              Show {section.title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
