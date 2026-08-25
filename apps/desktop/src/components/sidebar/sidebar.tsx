import { useState, type ReactElement } from 'react'
import { Checklist, Graph, Note, NoteEdit, Pencil, Terminal, User } from '@/components/icons'
import { isUntitledNotePath, type GraphInfo } from '@reflect/core'
import { AudioMemoButton } from '@/components/audio-memo/audio-memo-button'
import { usePinnedNotes } from '@/hooks/use-pinned-notes'
import { keybindingFor } from '@/lib/commands/app-commands'
import { runCommand } from '@/lib/commands/registry'
import { useToday } from '@/lib/use-today'
import type { CommandContext } from '@/lib/commands/types'
import { isMobileSurface } from '@/lib/platform-surface'
import { notePathForRoute } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { useShowAdvancedSurfaces } from '@/hooks/use-show-advanced-surfaces'
import { GraphFooter } from './graph-footer'
import { SidebarChatSection } from './sidebar-chat-section'
import { SidebarItem } from './sidebar-item'
import { SidebarMeetingsSection } from './sidebar-meetings-section'
import { SidebarOpenNotes } from './sidebar-open-notes'
import { SidebarPinned } from './sidebar-pinned'
import { SidebarSearch } from './sidebar-search'
import { SidebarSurfaceSwitcher } from './sidebar-surface-switcher'
import { SidebarTags } from './sidebar-tags'
import { readSidebarSurface, storeSidebarSurface, type SidebarSurface } from './sidebar-surface'

interface SidebarProps {
  graph: GraphInfo
  /** Commands run with this — the same context the palette/shortcuts use. */
  context: CommandContext
}

/**
 * The workspace sidebar. The Notion-style top bar (the Home pill, the
 * Chat/Meetings icon toggles, and the ever-present search + audio-memo
 * icons) and the graph-switcher footer are fixtures; between them the rail
 * is one of three surfaces — Home (the classic navigation plus the
 * Open/Pinned/Tags shelves), Chat (the AI conversation list), and Meetings
 * (the coming week's calendar events). Picking Chat also opens the chat
 * screen, since its rail is only useful beside the conversation. Most
 * nav rows run registered commands so a binding and its behavior stay one
 * definition; the Daily notes row is a capture gesture like `Mod-D` — it asks
 * the stream to focus today with the caret at the end, ready to append.
 * (Sidebar collapse stays on `Mod-\` via the command registry.)
 */
export function Sidebar({ graph, context }: SidebarProps): ReactElement {
  const { route } = useRouter()
  const today = useToday()
  const pinned = usePinnedNotes()
  const showAdvanced = useShowAdvancedSurfaces()
  const [surface, setSurface] = useState<SidebarSurface>(readSidebarSurface)
  const currentNotePath = notePathForRoute(route, today)
  const hasActivePinnedNote =
    currentNotePath !== null && pinned.some((note) => note.path === currentNotePath)

  const selectSurface = (next: SidebarSurface): void => {
    setSurface(next)
    storeSidebarSurface(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-col">
        {/* The title-bar band shares its 44px with the tab strip and the
            context rail's switcher — one optical line across the window,
            level with the sidebar-collapse toggle. The macOS traffic lights
            ride their own band above the window (see `WorkspaceContent`)
            rather than an inset carved out of this one, which is what leaves
            room for the pills, the lens and the mic on a single line. That
            band collapses in fullscreen, when the lights are hidden. All
            five read as one cluster against the band's left edge — they sit
            inside window-drag-control so they stay clickable while the
            stretch beyond them still drags the window. */}
        <div data-tauri-drag-region className="flex h-11 flex-none items-center pl-3 pr-2">
          <div className="window-drag-control flex min-w-0 items-center gap-0.5">
            <SidebarSurfaceSwitcher
              surface={surface}
              onSelect={(next) => {
                selectSurface(next)
                // The Chat rail is only useful beside the conversation, so
                // picking it opens the chat screen too.
                if (next === 'chat') {
                  void runCommand('chat.open', context)
                }
              }}
            />
            <SidebarSearch onOpen={() => context.openPalette()} />
            <AudioMemoButton />
          </div>
        </div>
      </div>

      {surface === 'home' && (
        <>
          <nav aria-label="Primary" className="mt-4 flex-none space-y-1 px-2">
            <SidebarItem
              icon={<Pencil className="size-3.5" />}
              label="Daily notes"
              binding={keybindingFor('nav.today') ?? undefined}
              active={(route.kind === 'today' || route.kind === 'daily') && !hasActivePinnedNote}
              onClick={() => void runCommand('nav.today', context)}
            />
            <SidebarItem
              icon={<NoteEdit className="size-3.5" />}
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
              icon={<Note className="size-3.5" />}
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
              icon={<Checklist className="size-3.5" />}
              label="Tasks"
              binding={keybindingFor('nav.tasks') ?? undefined}
              active={route.kind === 'tasks'}
              onClick={() => void runCommand('nav.tasks', context)}
            />
            {showAdvanced ? (
              <SidebarItem
                icon={<User className="size-3.5" />}
                label="Agents"
                binding={keybindingFor('nav.agents') ?? undefined}
                active={route.kind === 'agents'}
                onClick={() => void runCommand('nav.agents', context)}
              />
            ) : null}
            <SidebarItem
              icon={<Graph className="size-3.5" />}
              label="Graph"
              binding={keybindingFor('nav.graphMap') ?? undefined}
              active={route.kind === 'graphMap'}
              onClick={() => void runCommand('nav.graphMap', context)}
            />
            {isMobileSurface() ? null : (
              <SidebarItem
                icon={<Terminal className="size-3.5" />}
                label="Terminal"
                binding={keybindingFor('nav.terminal') ?? undefined}
                active={route.kind === 'terminal'}
                onClick={() => void runCommand('nav.terminal', context)}
              />
            )}
          </nav>
          <div className="mt-1 min-h-0 flex-1 overflow-y-auto pb-2">
            <SidebarOpenNotes />
            <SidebarPinned />
            <SidebarTags />
          </div>
        </>
      )}

      {surface === 'chat' && <SidebarChatSection />}
      {surface === 'meetings' && <SidebarMeetingsSection />}

      <GraphFooter graph={graph} context={context} />
    </div>
  )
}
