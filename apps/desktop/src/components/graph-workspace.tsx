import type { ReactElement, ReactNode } from 'react'
import type { GraphInfo } from '@reflect/core'
import { PaletteProvider } from '@/components/command-palette/palette-provider'
import { EnableLocalSyncDialog } from '@/components/enable-local-sync-dialog'
import { NoteWindowContent } from '@/components/note-window-content'
import { WorkspaceContent } from '@/components/workspace-content'
import { useNoteContentCache } from '@/hooks/use-note-content-cache'
import { getInitialWindowRoute } from '@/lib/windows/initial-window-route'
import { isMainWindow } from '@/lib/windows/window-role'
import { AssetDescribeProvider } from '@/providers/asset-describe-provider'
import { AudioMemoProvider } from '@/providers/audio-memo-provider'
import { FocusedDailyProvider } from '@/providers/focused-daily-provider'
import { CaptureProvider } from '@/providers/capture-provider'
import { ChatProvider } from '@/providers/chat-provider'
import { DeepLinkProvider } from '@/providers/deep-link-provider'
import { NoteFindProvider } from '@/providers/note-find-provider'
import { OpenTabsProvider } from '@/providers/open-tabs-provider'
import { NoteTemplatesProvider } from '@/providers/note-templates-provider'
import { PanesProvider, usePanes } from '@/providers/panes-provider'
import { ShortcutsProvider } from '@/providers/shortcuts-provider'
import { VaultReplaceProvider } from '@/providers/vault-replace-provider'
import { SidebarProvider } from '@/providers/sidebar-provider'
import { SyncProvider } from '@/providers/sync-provider'
import { V1ImportProvider } from '@/providers/v1-import-provider'
import { RouterProvider } from '@/routing/router'

interface GraphWorkspaceProps {
  graph: GraphInfo
}

/**
 * The main surface once a graph is open (Plan 06): mounts the per-graph
 * providers — the ⌘K palette, the sidebar state, and the router — around
 * {@link WorkspaceContent}. The app opens to today's daily note, the
 * chronological spine. Keyed by the graph root so switching graphs starts a
 * fresh history.
 *
 * Two window shapes, two routers. The main window owns a row of workspace
 * panes (split panes design, 2026-09-14): each column carries its own router
 * history and the chrome follows whichever pane is active, so the shared
 * providers sit under a binding to the active pane's stores. A ⌘-clicked note
 * window has no panes at all and keeps one private router for its one note.
 */
export function GraphWorkspace({ graph }: GraphWorkspaceProps): ReactElement {
  // Warm note opens for this graph (both window kinds): reopening a note is
  // served from the in-memory content cache instead of waiting on IPC.
  useNoteContentCache(graph.root)
  if (isMainWindow()) {
    return (
      <PanesProvider key={graph.root}>
        <ActivePaneRouter>
          <WorkspaceProviders graph={graph}>
            {/* Tabs and the focused day are per pane; the chrome reads the
              active one. The V1 import lives above the routed views so
              closing settings can't orphan a running import; main window
              only — its dialog is the import's single face. */}
            <ActivePaneChrome>
              <V1ImportProvider graph={graph}>
                <WorkspaceContent graph={graph} />
              </V1ImportProvider>
            </ActivePaneChrome>
          </WorkspaceProviders>
        </ActivePaneRouter>
      </PanesProvider>
    )
  }
  // A note window's first route is its ⌘-clicked target (seeded by the boot
  // hook) — starting on the default today route would flash the daily note
  // until the deep link navigated.
  const initialRoute = getInitialWindowRoute()
  return (
    <RouterProvider key={graph.root} {...(initialRoute !== null ? { initialRoute } : {})}>
      <WorkspaceProviders graph={graph}>
        {/* A ⌘-clicked note window is chrome-free: the routed view only, no
          sidebar/palette shell, no tab strip — so it carries its own
          focused-day and Find sessions rather than a pane's. */}
        <FocusedDailyProvider>
          <NoteFindProvider>
            <NoteWindowContent />
          </NoteFindProvider>
        </FocusedDailyProvider>
      </WorkspaceProviders>
    </RouterProvider>
  )
}

/**
 * The providers both window shapes share, inside a router binding. Sync,
 * palette, capture and deep links are window-wide: a pane switch must not
 * remount them.
 */
function WorkspaceProviders({
  graph,
  children,
}: {
  graph: GraphInfo
  children: ReactNode
}): ReactElement {
  return (
    <SyncProvider graph={graph}>
      {isMainWindow() ? <EnableLocalSyncDialog /> : null}
      <PaletteProvider>
        <ShortcutsProvider>
          <VaultReplaceProvider>
            <NoteTemplatesProvider>
              <SidebarProvider>
                {/* Above the sidebar: a recording must survive the sidebar (and its
                  mic button) unmounting on collapse. */}
                <AudioMemoProvider graph={graph}>
                  <CaptureProvider graph={graph}>
                    {/* Inside the router (deep links navigate) and beside capture
                      (deep-link writes spool into the same inbox drain). */}
                    <DeepLinkProvider graph={graph}>
                      <AssetDescribeProvider graph={graph}>
                        <ChatProvider graph={graph}>{children}</ChatProvider>
                      </AssetDescribeProvider>
                    </DeepLinkProvider>
                  </CaptureProvider>
                </AudioMemoProvider>
              </SidebarProvider>
            </NoteTemplatesProvider>
          </VaultReplaceProvider>
        </ShortcutsProvider>
      </PaletteProvider>
    </SyncProvider>
  )
}

/**
 * Binds the window-wide providers to the active pane's router, so everything
 * calling `useRouter()` above the pane row (deep links, the chrome) addresses
 * the column the user is in. Each pane binds the same store again for its own
 * subtree; two bindings of one store are fine.
 */
function ActivePaneRouter({ children }: { children: ReactNode }): ReactElement {
  const { activePane } = usePanes()
  return <RouterProvider store={activePane.router}>{children}</RouterProvider>
}

/**
 * The rest of the active pane's state for the chrome: the focused day the
 * context rail describes and the tab model the palette's tab commands drive.
 * Below {@link ChatProvider}, which `OpenTabsProvider` reads.
 */
function ActivePaneChrome({ children }: { children: ReactNode }): ReactElement {
  const { activePane } = usePanes()
  return (
    <FocusedDailyProvider store={activePane.focusedDaily}>
      <OpenTabsProvider paneId={activePane.id}>{children}</OpenTabsProvider>
    </FocusedDailyProvider>
  )
}
