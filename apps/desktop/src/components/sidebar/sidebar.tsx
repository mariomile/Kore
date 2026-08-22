import type { ReactElement } from 'react'
import { Chart, Chat, Checklist, Graph, Note, NoteEdit, Pencil, User } from '@/components/icons'
import { isUntitledNotePath, type GraphInfo } from '@reflect/core'
import { AudioMemoButton } from '@/components/audio-memo/audio-memo-button'
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-col">
        {/* The title-bar band shares its 44px with the tab strip and the
            context rail's switcher — one optical line across the window. On
            macOS the overlaid traffic lights own the band's left edge, so the
            row starts past them. Lens + mic sit as sibling icon buttons;
            window-drag-control keeps them clickable while the empty band
            still drags the window. */}
        <div
          data-tauri-drag-region
          className={cn(
            'flex h-11 flex-none items-center gap-0.5 pr-4',
            hasMacosTitleBarOverlay ? 'pl-20' : 'pl-3',
          )}
        >
          <div className="window-drag-control flex items-center">
            <SidebarSearch onOpen={() => context.openPalette()} />
            <AudioMemoButton />
          </div>
        </div>

        <nav aria-label="Primary" className="mt-5 space-y-1 px-4">
          <SidebarItem
            icon={<Pencil className="size-[17px]" />}
            label="Daily notes"
            binding={keybindingFor('nav.today') ?? undefined}
            active={(route.kind === 'today' || route.kind === 'daily') && !hasActivePinnedNote}
            onClick={() => void runCommand('nav.today', context)}
          />
          <SidebarItem
            icon={<NoteEdit className="size-[17px]" />}
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
            icon={<Note className="size-[17px]" />}
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
            icon={<Checklist className="size-[17px]" />}
            label="Tasks"
            binding={keybindingFor('nav.tasks') ?? undefined}
            active={route.kind === 'tasks'}
            onClick={() => void runCommand('nav.tasks', context)}
          />
          <SidebarItem
            icon={<Chat className="size-[17px]" />}
            label="Chat"
            binding={keybindingFor('chat.open') ?? undefined}
            active={route.kind === 'chat'}
            onClick={() => void runCommand('chat.open', context)}
          />
          <SidebarItem
            icon={<User className="size-[17px]" />}
            label="Agents"
            binding={keybindingFor('nav.agents') ?? undefined}
            active={route.kind === 'agents'}
            onClick={() => void runCommand('nav.agents', context)}
          />
          <SidebarItem
            icon={<Chart className="size-[17px]" />}
            label="Insights"
            binding={keybindingFor('nav.insights') ?? undefined}
            active={route.kind === 'insights'}
            onClick={() => void runCommand('nav.insights', context)}
          />
          <SidebarItem
            icon={<Graph className="size-[17px]" />}
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
