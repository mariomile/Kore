import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
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
import {
  hasOwnFolders,
  moveSidebarItem,
  SIDEBAR_SECTION_IDS,
  type SidebarHideable,
  type SidebarSection,
} from '@reflect/core'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFolderTree } from '@/hooks/use-folder-tree'
import { usePinnedNotes } from '@/hooks/use-pinned-notes'
import { useTagTree } from '@/hooks/use-tag-tree'
import { INVALIDATE_THROTTLE_MS } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import { SidebarFolders } from './sidebar-folders'
import { SIDEBAR_NAV_LABELS } from './sidebar-nav'
import { SidebarPinned } from './sidebar-pinned'
import {
  SidebarShelfArrangementContext,
  type SidebarShelfArrangement,
} from './sidebar-sortable-section'
import { SidebarTags } from './sidebar-tags'

/** Each shelf's component, keyed by the id the stored order is written in. */
const SECTION_COMPONENTS: Record<SidebarSection, () => ReactElement | null> = {
  pinned: SidebarPinned,
  folders: SidebarFolders,
  tags: SidebarTags,
}

/** Each shelf's header title, also its name in the "hidden" menu. */
const SECTION_TITLES: Record<SidebarSection, string> = {
  pinned: 'Pinned notes',
  folders: 'Folders',
  tags: 'Types',
}

/** The name a hidden row or shelf goes by in the "hidden" menu. */
function hiddenTitle(id: SidebarHideable): string {
  return id in SECTION_TITLES
    ? SECTION_TITLES[id as SidebarSection]
    : SIDEBAR_NAV_LABELS[id as Exclude<SidebarHideable, SidebarSection>]
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
 * introduced later simply appears at the bottom. Each header's "…" menu moves
 * or hides its shelf; hidden shelves and navigation rows come back from the
 * quiet "hidden" line at the foot of the list (`hiddenSidebarItems`).
 *
 * Every shelf is built from the index, so on a first open of a big vault all
 * of them are empty until the index lands, and then they would pop in one
 * under another. While the index is building and nothing has arrived yet,
 * a quiet placeholder holds their place instead, and the shelves fade in
 * together when it goes. The shelves refetch on the throttled index
 * invalidation, so they can still be empty for one throttle window after
 * the pass ends; the placeholder outlasts the pass by that window unless a
 * shelf arrives first.
 */
export function SidebarSections(): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
  const { indexing } = useGraph()
  const folderTree = useFolderTree()
  const tagTree = useTagTree()
  const pinned = usePinnedNotes()
  const settling = useSettleWindow(indexing)
  const waitingForIndex =
    (indexing || settling) &&
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

  const hidden = settings.hiddenSidebarItems
  // The shelves actually on screen: a shelf that is empty renders nothing, so
  // a menu step skips it and one press always visibly moves the shelf.
  const present = useMemo(() => {
    const shown: Record<SidebarSection, boolean> = {
      pinned: pinned.length > 0,
      folders: folderTree !== null && hasOwnFolders(folderTree),
      tags: tagTree.length > 0,
    }
    return SIDEBAR_SECTION_IDS.filter((id) => shown[id] && !hidden.includes(id))
  }, [pinned.length, folderTree, tagTree.length, hidden])
  const arrangement = useMemo<SidebarShelfArrangement>(() => {
    const onScreen = settings.sidebarSections.filter((id) => present.includes(id))
    return {
      canMove: (id, direction) => {
        const at = onScreen.indexOf(id)
        return at !== -1 && (direction === 'up' ? at > 0 : at < onScreen.length - 1)
      },
      move: (id, direction) => {
        updateSettingsWith((current) => ({
          sidebarSections: moveSidebarItem(current.sidebarSections, present, id, direction),
        }))
      },
      hide: (id) => {
        updateSettingsWith((current) => ({
          hiddenSidebarItems: [...current.hiddenSidebarItems.filter((entry) => entry !== id), id],
        }))
      },
    }
  }, [settings.sidebarSections, present, updateSettingsWith])
  const show = useCallback(
    (id: SidebarHideable): void => {
      updateSettingsWith((current) => ({
        hiddenSidebarItems: current.hiddenSidebarItems.filter((entry) => entry !== id),
      }))
    },
    [updateSettingsWith],
  )

  if (waitingForIndex) {
    return <ShelvesPlaceholder />
  }

  return (
    <div className="animate-in fade-in-0 duration-200 ease-swift motion-reduce:animate-none">
      <SidebarShelfArrangementContext value={arrangement}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={settings.sidebarSections} strategy={verticalListSortingStrategy}>
            {settings.sidebarSections
              .filter((id) => !hidden.includes(id))
              .map((id) => {
                const Section = SECTION_COMPONENTS[id]
                return <Section key={id} />
              })}
          </SortableContext>
        </DndContext>
      </SidebarShelfArrangementContext>
      {hidden.length === 0 ? null : <HiddenItemsMenu items={hidden} onShow={show} />}
    </div>
  )
}

interface HiddenItemsMenuProps {
  items: readonly SidebarHideable[]
  onShow: (id: SidebarHideable) => void
}

/** The way back for hidden rows and shelves: a quiet line with a menu of them. */
function HiddenItemsMenu({ items, onShow }: HiddenItemsMenuProps): ReactElement {
  return (
    <div className="mt-4 px-4.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="rounded text-2xs font-medium text-text-muted transition-colors duration-100 hover:text-text-secondary"
            >
              {items.length === 1 ? '1 hidden item' : `${items.length} hidden items`}
            </button>
          }
        />
        <DropdownMenuContent align="start" sideOffset={4} className="min-w-44">
          {items.map((id) => (
            <DropdownMenuItem
              key={id}
              onClick={() => {
                onShow(id)
              }}
            >
              Show {hiddenTitle(id)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * True for one index-refetch window after `active` turns false, so a consumer
 * can wait for the trailing invalidation that carries the pass's last rows.
 */
function useSettleWindow(active: boolean): boolean {
  const [previous, setPrevious] = useState(active)
  const [settling, setSettling] = useState(false)
  // Derived during render, not in an effect: the paint where `active` turns
  // false must already be settling, or the consumer flashes for one frame.
  if (previous !== active) {
    setPrevious(active)
    setSettling(previous && !active)
  }
  useEffect(() => {
    if (!settling) {
      return
    }
    const timer = setTimeout(() => setSettling(false), INVALIDATE_THROTTLE_MS)
    return () => clearTimeout(timer)
  }, [settling])
  return settling
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
            'h-3 animate-pulse rounded-sm bg-surface-hover motion-reduce:animate-none',
            index === 0 ? 'mb-3 h-2.5' : '',
            width,
          )}
        />
      ))}
    </div>
  )
}
