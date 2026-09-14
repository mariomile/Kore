import { useCallback, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { AppShell } from '@/components/app-shell'
import { NoteFindBar } from '@/components/note-find-bar'
import { WorkspaceTabsStrip } from '@/components/note-tabs-strip'
import { RouteContent } from '@/components/route-content'
import type { CommandContext } from '@/lib/commands/types'
import { cn } from '@/lib/utils'
import { FocusedDailyProvider } from '@/providers/focused-daily-provider'
import { NoteFindProvider } from '@/providers/note-find-provider'
import { OpenTabsProvider } from '@/providers/open-tabs-provider'
import { PaneScope, usePanes, type WorkspacePaneHandle } from '@/providers/panes-provider'
import { RouterProvider } from '@/routing/router'

interface WorkspacePaneProps {
  pane: WorkspacePaneHandle
  commandContext: CommandContext
}

/**
 * One column of the workspace: its own router history, tab strip, focused
 * daily day, and Find session, bound to the pane's stores so everything
 * inside addresses this pane. Pointer or keyboard focus anywhere inside
 * makes it the active pane, which is what the chrome (sidebar, palette,
 * context rail) follows.
 */
export function WorkspacePane({ pane, commandContext }: WorkspacePaneProps): ReactElement {
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
          <OpenTabsProvider paneId={pane.id}>
            <NoteFindProvider>
              <div
                data-testid="workspace-pane"
                data-active={active ? 'true' : undefined}
                onPointerDownCapture={activate}
                onFocusCapture={activate}
                className="workspace-main flex min-w-[360px] flex-1 flex-col"
              >
                <WorkspaceTabsStrip commandContext={commandContext} />
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

/**
 * Divider between two panes. Drag sets the left pane's flex-basis in pixels
 * for this session only; widths reset on relaunch by design.
 */
export function PaneResizeHandle({ leftPaneId }: { leftPaneId: string }): ReactElement {
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const handle = event.currentTarget
    const left = handle.previousElementSibling
    if (!(left instanceof HTMLElement)) {
      return
    }
    const startX = event.clientX
    const startWidth = left.getBoundingClientRect().width
    handle.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => {
      left.style.flex = `0 0 ${Math.max(360, startWidth + move.clientX - startX)}px`
    }
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize pane"
      data-left-pane={leftPaneId}
      onPointerDown={onPointerDown}
      className="relative w-2 shrink-0 cursor-col-resize after:absolute after:inset-y-0 after:w-0.5 after:bg-border-strong after:opacity-0 hover:after:opacity-60"
    />
  )
}
