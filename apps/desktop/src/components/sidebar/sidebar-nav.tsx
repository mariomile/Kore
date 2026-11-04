import { useCallback, useMemo, type MouseEvent, type ReactElement, type ReactNode } from 'react'
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
import {
  errorMessage,
  isUntitledNotePath,
  moveSidebarItem,
  SIDEBAR_NAV_IDS,
  type SidebarNavItem,
} from '@reflect/core'
import { Checklist, Graph, Note, NoteEdit, Pencil } from '@/components/icons'
import { keybindingFor } from '@/lib/commands/app-commands'
import { runCommand } from '@/lib/commands/registry'
import type { CommandContext } from '@/lib/commands/types'
import { openNativeContextMenu } from '@/lib/native-menu/context-menu'
import { startOperation } from '@/lib/operations'
import { sortableTranslateStyle } from '@/lib/sortable-translate'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import type { Route } from '@/routing/route'
import { SidebarItem } from './sidebar-item'

/** What one navigation row needs to render: everything but its position. */
interface NavRowSpec {
  label: string
  icon: ReactNode
  commandId: string
  active: boolean
}

interface NavRowState {
  route: Route
  /** A pinned note is open, so its Pinned row owns the highlight. */
  hasActivePinnedNote: boolean
}

/** The visible label of each row, also its name in the "hidden" menu. */
export const SIDEBAR_NAV_LABELS: Record<SidebarNavItem, string> = {
  daily: 'Daily notes',
  newNote: 'New note',
  allNotes: 'All notes',
  tasks: 'Tasks',
  graph: 'Graph',
}

function rowSpec(id: SidebarNavItem, { route, hasActivePinnedNote }: NavRowState): NavRowSpec {
  const label = SIDEBAR_NAV_LABELS[id]
  switch (id) {
    case 'daily':
      return {
        label,
        icon: <Pencil className="size-3.5" />,
        commandId: 'nav.today',
        active: (route.kind === 'today' || route.kind === 'daily') && !hasActivePinnedNote,
      }
    case 'newNote':
      // Active while the open note is still on its ULID placeholder name, the
      // state this row creates. The birth rename onto a title slug hands the
      // note off to ordinary navigation, releasing the highlight.
      return {
        label,
        icon: <NoteEdit className="size-3.5" />,
        commandId: 'note.new',
        active: route.kind === 'note' && isUntitledNotePath(route.path),
      }
    case 'allNotes':
      // A named note lives in the All Notes collection, so keep this row lit
      // while editing one; a brand-new note belongs to "New note" until its
      // birth rename. A routed tag or folder is that tag's or folder's own
      // page: its row in the Types or Folders shelf lights instead.
      return {
        label,
        icon: <Note className="size-3.5" />,
        commandId: 'nav.allNotes',
        active:
          (route.kind === 'allNotes' &&
            route.filter.kind !== 'tag' &&
            route.filter.kind !== 'folder') ||
          (route.kind === 'note' && !isUntitledNotePath(route.path) && !hasActivePinnedNote),
      }
    case 'tasks':
      return {
        label,
        icon: <Checklist className="size-3.5" />,
        commandId: 'nav.tasks',
        active: route.kind === 'tasks',
      }
    case 'graph':
      return {
        label,
        icon: <Graph className="size-3.5" />,
        commandId: 'nav.graphMap',
        active: route.kind === 'graphMap',
      }
  }
}

function navIdFor(id: unknown): SidebarNavItem | null {
  return SIDEBAR_NAV_IDS.find((entry) => entry === String(id)) ?? null
}

interface SidebarNavProps extends NavRowState {
  context: CommandContext
}

/**
 * The Home surface's primary navigation, in the user's arrangement: rows drag
 * into any order (the same 4px activation as the shelves, so a click still
 * navigates), and a right-click offers Move up, Move down and Hide. Hidden
 * rows come back from the "hidden" menu at the foot of the shelves. Order and
 * hidden set persist in the `sidebarNav` / `hiddenSidebarItems` settings.
 */
export function SidebarNav({ context, route, hasActivePinnedNote }: SidebarNavProps): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const hidden = settings.hiddenSidebarItems
  const visible = useMemo(
    () => settings.sidebarNav.filter((id) => !hidden.includes(id)),
    [settings.sidebarNav, hidden],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const { active, over } = event
      const dragged = navIdFor(active.id)
      const target = over === null ? null : navIdFor(over.id)
      if (dragged === null || target === null || dragged === target) {
        return
      }
      updateSettingsWith((current) => {
        const from = current.sidebarNav.indexOf(dragged)
        const to = current.sidebarNav.indexOf(target)
        return from === -1 || to === -1
          ? {}
          : { sidebarNav: arrayMove(current.sidebarNav, from, to) }
      })
    },
    [updateSettingsWith],
  )

  const openMenu = useCallback(
    (id: SidebarNavItem, index: number): void => {
      const move = (direction: 'up' | 'down') => () => {
        updateSettingsWith((current) => ({
          sidebarNav: moveSidebarItem(
            current.sidebarNav,
            current.sidebarNav.filter((entry) => !current.hiddenSidebarItems.includes(entry)),
            id,
            direction,
          ),
        }))
      }
      const items = [
        ...(index > 0 ? [{ text: 'Move Up', action: move('up') }] : []),
        ...(index < visible.length - 1 ? [{ text: 'Move Down', action: move('down') }] : []),
        {
          text: `Hide ${SIDEBAR_NAV_LABELS[id]}`,
          action: () => {
            updateSettingsWith((current) => ({
              hiddenSidebarItems: [
                ...current.hiddenSidebarItems.filter((entry) => entry !== id),
                id,
              ],
            }))
          },
        },
      ]
      void openNativeContextMenu({ items }).catch((cause: unknown) => {
        startOperation('Opening sidebar menu').fail(errorMessage(cause))
      })
    },
    [updateSettingsWith, visible.length],
  )

  return (
    <nav aria-label="Primary" className="mt-4 flex-none space-y-1 px-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visible} strategy={verticalListSortingStrategy}>
          {visible.map((id, index) => (
            <SortableNavRow
              key={id}
              id={id}
              spec={rowSpec(id, { route, hasActivePinnedNote })}
              onRun={(commandId) => void runCommand(commandId, context)}
              onContextMenu={(event) => {
                event.preventDefault()
                openMenu(id, index)
              }}
            />
          ))}
        </SortableContext>
      </DndContext>
    </nav>
  )
}

interface SortableNavRowProps {
  id: SidebarNavItem
  spec: NavRowSpec
  onRun: (commandId: string) => void
  onContextMenu: (event: MouseEvent<HTMLElement>) => void
}

function SortableNavRow({ id, spec, onRun, onContextMenu }: SortableNavRowProps): ReactElement {
  const { isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      data-sidebar-nav={id}
      style={sortableTranslateStyle(transform, transition)}
      className={cn('touch-none', isDragging && 'relative z-10 opacity-70')}
      onContextMenu={onContextMenu}
      {...listeners}
    >
      <SidebarItem
        icon={spec.icon}
        label={spec.label}
        binding={keybindingFor(spec.commandId) ?? undefined}
        active={spec.active}
        onClick={() => {
          onRun(spec.commandId)
        }}
      />
    </div>
  )
}
