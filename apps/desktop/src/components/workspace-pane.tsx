import { useCallback, type ReactElement } from 'react'
import { AppShell } from '@/components/app-shell'
import { NoteFindBar } from '@/components/note-find-bar'
import { WorkspaceTabsStrip } from '@/components/note-tabs-strip'
import { RouteContent } from '@/components/route-content'
import type { CommandContext } from '@/lib/commands/types'
import { cn } from '@/lib/utils'
import { FocusedDailyArrivalReset, FocusedDailyProvider } from '@/providers/focused-daily-provider'
import { NoteFindProvider } from '@/providers/note-find-provider'
import { OpenTabsProvider } from '@/providers/open-tabs-provider'
import { PaneScope, usePanes, type WorkspacePaneHandle } from '@/providers/panes-provider'
import { RouterProvider } from '@/routing/router'

interface WorkspacePaneProps {
  pane: WorkspacePaneHandle
  commandContext: CommandContext
  /** The rail toggles belong to one strip only, not to every pane. */
  showSidebarToggle: boolean
  showContextToggle: boolean
}

/**
 * One pane of the workspace: its own router history, tab strip, focused
 * daily day, and Find session, bound to the pane's stores so everything
 * inside addresses this pane. Pointer or keyboard focus anywhere inside
 * makes it the active pane, which is what the chrome (sidebar, palette,
 * context rail) follows.
 */
export function WorkspacePane({
  pane,
  commandContext,
  showSidebarToggle,
  showContextToggle,
}: WorkspacePaneProps): ReactElement {
  const { activePane, setActivePane } = usePanes()
  const active = activePane.id === pane.id
  const activate = useCallback(() => {
    if (!active) {
      setActivePane(pane.id)
    }
  }, [active, pane.id, setActivePane])

  return (
    <PaneScope id={pane.id}>
      <RouterProvider store={pane.router}>
        <FocusedDailyProvider store={pane.focusedDaily}>
          {/* The focused day is this pane's: only the pane that owns the
            router and the store may reset it on arrival. */}
          <FocusedDailyArrivalReset />
          <OpenTabsProvider paneId={pane.id}>
            <NoteFindProvider>
              {/* The row handle clamps only the pane it drags, so the floor
                lives on the pane itself: without it, dragging a divider to
                the bottom crushes the pane below to nothing. */}
              <div
                data-testid="workspace-pane"
                data-active={active ? 'true' : undefined}
                onPointerDownCapture={activate}
                onFocusCapture={activate}
                className="workspace-main flex min-h-[200px] min-w-0 flex-1 flex-col"
              >
                <WorkspaceTabsStrip
                  commandContext={commandContext}
                  showSidebarToggle={showSidebarToggle}
                  showContextToggle={showContextToggle}
                />
                <div
                  data-testid="note-pane-gutter"
                  className="workspace-pane-gutter min-h-0 flex-1 pl-2 pb-2"
                >
                  <div
                    className={cn(
                      'app-glass-card h-full overflow-hidden rounded-xl bg-surface',
                      !active && 'opacity-95',
                    )}
                  >
                    <AppShell className="bg-transparent">
                      <div className="relative flex h-full flex-col">
                        <div className="min-h-0 flex-1">
                          <RouteContent />
                        </div>

                        <NoteFindBar />
                      </div>
                    </AppShell>
                  </div>
                </div>
              </div>
            </NoteFindProvider>
          </OpenTabsProvider>
        </FocusedDailyProvider>
      </RouterProvider>
    </PaneScope>
  )
}
