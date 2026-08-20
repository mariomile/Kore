import type { ReactElement } from 'react'
import { isUntitledNotePath, type GraphInfo } from '@reflect/core'
import { Bot, ChartColumn, ListChecks, MessageSquare, SquarePen, Waypoints } from 'lucide-react'
import { AudioMemoButton } from '@/components/audio-memo/audio-memo-button'
import { ListIcon } from '@/components/icons/list-icon'
import { PencilIcon } from '@/components/icons/pencil-icon'
import { usePinnedNotes } from '@/hooks/use-pinned-notes'
import { keybindingFor } from '@/lib/commands/app-commands'
import { runCommand } from '@/lib/commands/registry'
import { useToday } from '@/lib/use-today'
import type { CommandContext } from '@/lib/commands/types'
import { cn } from '@/lib/utils'
import { hasMacosTitleBarOverlay } from '@/lib/window-chrome'
import { notePathForRoute } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { GraphFooter } from './graph-footer'
import { SidebarItem } from './sidebar-item'
import { SidebarOpenNotes } from './sidebar-open-notes'
import { SidebarPinned } from './sidebar-pinned'
import { SidebarSearch } from './sidebar-search'
import { SidebarTags } from './sidebar-tags'

interface SidebarProps {
  graph: GraphInfo
  /** Commands run with this — the same context the palette/shortcuts use. */
  context: CommandContext
}

/**
 * The workspace sidebar: search, primary navigation with hover-revealed shortcut keycaps, the
 * Pinned shelf, and the graph switcher footer. Most nav rows run registered
 * commands so a binding and its behavior stay one definition; the Daily notes
 * row is a capture gesture like `Mod-D` — it asks the stream to focus today
 * with the caret at the end, ready to append. (Sidebar collapse stays on
 * `Mod-\` via the command registry.)
 */
export function Sidebar({ graph, context }: SidebarProps): ReactElement {
  const { route } = useRouter()
  const today = useToday()
  const pinned = usePinnedNotes()
  const currentNotePath = notePathForRoute(route, today)
  const hasActivePinnedNote =
    currentNotePath !== null && pinned.some((note) => note.path === currentNotePath)

  // Wrap the 16px Lucide glyphs in the custom icons' 24px box so nav rows
  // share one icon footprint.
  const lucideBox = 'flex size-6 shrink-0 items-center justify-center'

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col',
        // The sidebar runs the full window height, so on macOS the overlaid
        // traffic lights and the WindowDragRegion strip sit over its top —
        // start the search band below them.
        hasMacosTitleBarOverlay && 'pt-9',
      )}
    >
      <div className="flex flex-none flex-col">
        {/* The search row shares the 44px top band with the tab strip and the
            context rail's switcher — one optical line across the window. */}
        <div className="flex h-11 flex-none items-center gap-1.5 px-4">
          <div className="min-w-0 flex-1">
            <SidebarSearch onOpen={() => context.openPalette()} />
          </div>
          <AudioMemoButton />
        </div>

        <nav aria-label="Primary" className="mt-5 space-y-1 px-4">
          <SidebarItem
            icon={<PencilIcon className="shrink-0" />}
            label="Daily notes"
            binding={keybindingFor('nav.today') ?? undefined}
            active={(route.kind === 'today' || route.kind === 'daily') && !hasActivePinnedNote}
            onClick={() => void runCommand('nav.today', context)}
          />
          <SidebarItem
            icon={
              <span className={lucideBox}>
                <SquarePen aria-hidden strokeWidth={1.75} className="size-4" />
              </span>
            }
            label="New note"
            binding={keybindingFor('note.new') ?? undefined}
            // Active while the open note is still on its ULID placeholder
            // name — the state this row creates. The birth rename onto a
            // title slug is also what hands the note off to ordinary
            // navigation, releasing the highlight.
            active={route.kind === 'note' && isUntitledNotePath(route.path)}
            onClick={() => void runCommand('note.new', context)}
          />
          <SidebarItem
            icon={<ListIcon className="shrink-0" />}
            label="All notes"
            binding={keybindingFor('nav.allNotes') ?? undefined}
            // A named note lives in the All Notes collection, so keep this row
            // lit while editing one. A brand-new note is still an untitled
            // placeholder, though, and the "New note" row above owns that
            // highlight until the birth rename — so the two never light at once.
            active={
              route.kind === 'allNotes' ||
              (route.kind === 'note' && !isUntitledNotePath(route.path) && !hasActivePinnedNote)
            }
            onClick={() => void runCommand('nav.allNotes', context)}
          />
          <SidebarItem
            icon={
              <span className={lucideBox}>
                <ListChecks aria-hidden strokeWidth={1.75} className="size-4" />
              </span>
            }
            label="Tasks"
            binding={keybindingFor('nav.tasks') ?? undefined}
            active={route.kind === 'tasks'}
            onClick={() => void runCommand('nav.tasks', context)}
          />
          <SidebarItem
            icon={
              <span className={lucideBox}>
                <MessageSquare aria-hidden strokeWidth={1.75} className="size-4" />
              </span>
            }
            label="Chat"
            binding={keybindingFor('chat.open') ?? undefined}
            active={route.kind === 'chat'}
            onClick={() => void runCommand('chat.open', context)}
          />
          <SidebarItem
            icon={
              <span className={lucideBox}>
                <Bot aria-hidden strokeWidth={1.75} className="size-4" />
              </span>
            }
            label="Agents"
            binding={keybindingFor('nav.agents') ?? undefined}
            active={route.kind === 'agents'}
            onClick={() => void runCommand('nav.agents', context)}
          />
          <SidebarItem
            icon={
              <span className={lucideBox}>
                <ChartColumn aria-hidden strokeWidth={1.75} className="size-4" />
              </span>
            }
            label="Insights"
            binding={keybindingFor('nav.insights') ?? undefined}
            active={route.kind === 'insights'}
            onClick={() => void runCommand('nav.insights', context)}
          />
          <SidebarItem
            icon={
              <span className={lucideBox}>
                <Waypoints aria-hidden strokeWidth={1.75} className="size-4" />
              </span>
            }
            label="Graph"
            binding={keybindingFor('nav.graphMap') ?? undefined}
            active={route.kind === 'graphMap'}
            onClick={() => void runCommand('nav.graphMap', context)}
          />
        </nav>
      </div>

      <div className="mt-1 min-h-0 flex-1 overflow-y-auto pb-2">
        <SidebarOpenNotes />
        <SidebarPinned />
        <SidebarTags />
      </div>

      <GraphFooter graph={graph} context={context} />
    </div>
  )
}
