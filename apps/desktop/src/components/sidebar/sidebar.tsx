import { useState, type ReactElement } from 'react'
import type { GraphInfo } from '@kore/core'
import { AudioMemoButton } from '@/components/audio-memo/audio-memo-button'
import { usePinnedNotes } from '@/hooks/use-pinned-notes'
import { runCommand } from '@/lib/commands/registry'
import { useToday } from '@/lib/use-today'
import type { CommandContext } from '@/lib/commands/types'
import { notePathForRoute } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { GraphFooter } from './graph-footer'
import { SidebarChatSection } from './sidebar-chat-section'
import { SidebarMeetingsSection } from './sidebar-meetings-section'
import { SidebarNav } from './sidebar-nav'
import { SidebarSearch } from './sidebar-search'
import { SidebarSections } from './sidebar-sections'
import { SidebarSurfaceSwitcher } from './sidebar-surface-switcher'
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
 * is one of three surfaces — Home (the navigation rows plus the
 * Pinned/Folders/Types shelves, all of which the user can drag into any
 * order or hide; see {@link SidebarNav} and {@link SidebarSections}), Chat
 * (the AI conversation list), and Meetings (the coming week's calendar
 * events). Picking Chat also opens the chat screen, since its rail is only
 * useful beside the conversation. The nav rows run registered commands so a
 * binding and its behavior stay one definition. The terminal is not a row:
 * it opens as a tab from the tab strip's "+" menu (or the palette).
 * (Sidebar collapse stays on `Mod-\` via the command registry.)
 */
export function Sidebar({ graph, context }: SidebarProps): ReactElement {
  const { route } = useRouter()
  const today = useToday()
  const pinned = usePinnedNotes()
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
            band collapses in fullscreen, when the lights are hidden. The
            surface pills hold the band's left edge and the lens and mic sit
            against its right edge, with the draggable gap between them; both
            clusters sit inside window-drag-control so they stay clickable
            while that gap still drags the window. */}
        <div
          data-tauri-drag-region
          className="flex h-11 flex-none items-center justify-between gap-2 pl-3 pr-2"
        >
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
          </div>
          <div className="window-drag-control flex flex-none items-center gap-0.5">
            <SidebarSearch onOpen={() => context.openPalette()} />
            <AudioMemoButton />
          </div>
        </div>
      </div>

      {surface === 'home' && (
        <>
          <SidebarNav context={context} route={route} hasActivePinnedNote={hasActivePinnedNote} />
          <div className="mt-1 min-h-0 flex-1 overflow-y-auto pb-2">
            <SidebarSections />
          </div>
        </>
      )}

      {surface === 'chat' && <SidebarChatSection />}
      {surface === 'meetings' && <SidebarMeetingsSection />}

      <GraphFooter graph={graph} context={context} />
    </div>
  )
}
