import { useEffect, type ReactElement } from 'react'
import { subscribeBrowserNavigated, type GraphInfo } from '@reflect/core'
import { AppShell } from '@/components/app-shell'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { ContextSidebar } from '@/components/context-sidebar/context-sidebar'
import { AgentRoutinesRunner } from '@/components/agent-routines-runner'
import { TaskRemindersRunner } from '@/components/task-reminders-runner'
import { EmbeddingsSync } from '@/components/embeddings-sync'
import { NoteFindBar } from '@/components/note-find-bar'
import { NoteTabsStrip } from '@/components/note-tabs-strip'
import { RouteContent } from '@/components/route-content'
import { VaultReplaceMount } from '@/components/vault-replace/vault-replace-dialog'
import { ShortcutsDialog } from '@/components/shortcuts-dialog'
import { Sidebar } from '@/components/sidebar/sidebar'
import { SidebarResizeHandle } from '@/components/sidebar-resize-handle'
import { TemplateCreateDialog } from '@/components/templates/template-create-dialog'
import { TemplatePicker } from '@/components/templates/template-picker'
import { registerInAppBrowserOpener, setBrowserSessionUrl } from '@/lib/browser-session'
import { useMacosTrafficLightInset } from '@/lib/use-macos-traffic-light-inset'
import { useDailyContextTarget } from '@/providers/focused-daily-provider'
import { useSidebar } from '@/providers/sidebar-provider'
import { useAppShortcuts } from '@/routing/app-shortcuts'
import { useRouter } from '@/routing/router'

interface WorkspaceContentProps {
  graph: GraphInfo
}

/**
 * Everything inside the workspace's providers: two full-height sidebars — the
 * workspace rail on the left, the context rail (details, chat, calendar,
 * tags, browser, terminal) on the right — and between them the content
 * column: the tab bar over a floating note-pane card with all four corners
 * rounded and the sunken chrome color as its gutter, one shade with the
 * rails and the tab strip in every theme. A collapsed rail unmounts — the
 * layout snaps instead of animating, and panels hosting live surfaces (the
 * embedded browser) release them. The always-mounted global surfaces
 * (⌘K palette, find bar, embeddings sync) ride inside the card with the
 * route. Split from {@link GraphWorkspace} because these hooks need the
 * providers it mounts.
 */
export function WorkspaceContent({ graph }: WorkspaceContentProps): ReactElement {
  const { collapsed, contextCollapsed } = useSidebar()
  const commandContext = useAppShortcuts()
  const { navigate } = useRouter()
  // Web links land in the built-in browser tab: the workspace registers the
  // opener that plain modules (the editor's link handler) route through.
  useEffect(
    () =>
      registerInAppBrowserOpener((url) => {
        setBrowserSessionUrl(url)
        navigate({ kind: 'browser' })
      }),
    [navigate],
  )
  // The session URL follows every navigation — including pages the AI's
  // browse tools load while no pane is mounted, so a later mount docks the
  // agent's page instead of navigating back to a stale one. No bridge (the
  // web harness, tests) just means no embedded browser to follow.
  useEffect(() => {
    let unlisten: Promise<() => void>
    try {
      unlisten = subscribeBrowserNavigated((event) => {
        setBrowserSessionUrl(event.url)
      })
    } catch {
      return
    }
    return () => {
      void unlisten
        .then((stop) => {
          stop()
        })
        .catch(() => undefined)
    }
  }, [])
  // Daily routes get the day's contextual panel and note routes the note's;
  // search/settings get none (AppShell omits the region when context is absent).
  // In the daily stream the route stays put while focus moves between days, so
  // the panel follows the focused day and snaps back on navigation.
  const contextTarget = useDailyContextTarget()
  const trafficLightBand = useMacosTrafficLightInset()

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-sunken text-text">
      {/* The macOS traffic lights get a band of their own across the whole
          window, rather than an inset carved out of whichever pane reaches
          the left edge. That inset cost the workspace rail 80 of its 260
          points — enough that the surface pills, the lens and the mic could
          not share a line. `WindowDragRegion` (28px, mounted at the desktop
          root) already covers this strip, so it needs no drag handler of
          its own; it only has to reserve the height — and only while the
          lights are actually on screen. Native fullscreen hides them, and
          keeping the band would be a blank 28px gap across the window. */}
      {trafficLightBand ? (
        <div aria-hidden data-testid="macos-traffic-light-band" className="h-7 flex-none" />
      ) : null}

      <div className="flex min-h-0 flex-1">
        {collapsed ? undefined : (
          <aside
            id="workspace-sidebar"
            aria-label="Workspace"
            className="relative flex w-[var(--sidebar-width)] shrink-0 flex-col overflow-hidden bg-surface-sunken"
          >
            <Sidebar graph={graph} context={commandContext} />
            <SidebarResizeHandle panel="workspace" />
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <NoteTabsStrip commandContext={commandContext} />
          <div className="min-h-0 flex-1">
            <div className="app-glass-card h-full overflow-hidden rounded-xl bg-surface">
              <AppShell className="bg-transparent">
                <div className="relative flex h-full flex-col">
                  <div className="min-h-0 flex-1">
                    <RouteContent />
                  </div>

                  <NoteFindBar />
                  <CommandPalette context={commandContext} />
                  <ShortcutsDialog />
                  <VaultReplaceMount />
                  <TemplatePicker context={commandContext} />
                  <TemplateCreateDialog context={commandContext} />
                  <EmbeddingsSync />
                  <AgentRoutinesRunner />
                  <TaskRemindersRunner />
                </div>
              </AppShell>
            </div>
          </div>
        </div>

        {contextCollapsed ? undefined : (
          <aside
            id="context-sidebar"
            aria-label="Context"
            className="relative hidden w-[var(--context-sidebar-width)] shrink-0 overflow-hidden bg-surface-sunken lg:flex lg:flex-col"
          >
            <SidebarResizeHandle panel="context" />
            <ContextSidebar target={contextTarget} />
          </aside>
        )}
      </div>
    </div>
  )
}
