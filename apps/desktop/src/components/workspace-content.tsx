import { Fragment, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { subscribeBrowserNavigated, type GraphInfo } from '@reflect/core'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { ContextSidebar } from '@/components/context-sidebar/context-sidebar'
import { AgentRoutinesRunner } from '@/components/agent-routines-runner'
import { TaskRemindersRunner } from '@/components/task-reminders-runner'
import { EmbeddingsSync } from '@/components/embeddings-sync'
import { RouteContent } from '@/components/route-content'
import { VaultReplaceMount } from '@/components/vault-replace/vault-replace-dialog'
import { ShortcutsDialog } from '@/components/shortcuts-dialog'
import { Sidebar } from '@/components/sidebar/sidebar'
import { SidebarResizeHandle } from '@/components/sidebar-resize-handle'
import { TemplateCreateDialog } from '@/components/templates/template-create-dialog'
import { TemplatePicker } from '@/components/templates/template-picker'
import { PaneDragContext } from '@/components/pane-drop-zones'
import { PaneResizeHandle } from '@/components/pane-resize-handle'
import { WorkspacePane } from '@/components/workspace-pane'
import { registerInAppBrowserOpener, setBrowserSessionUrl } from '@/lib/browser-session'
import { dropTab, resolveTabDrop } from '@/lib/tab-drop'
import { tabDropCollision } from '@/lib/tab-drop-collision'
import type { CommandContext } from '@/lib/commands/types'
import { useMacosTrafficLightInset } from '@/lib/use-macos-traffic-light-inset'
import { useOptionalChatSession } from '@/providers/chat-provider'
import { useDailyContextTarget } from '@/providers/focused-daily-provider'
import { usePanes } from '@/providers/panes-provider'
import { useSidebar } from '@/providers/sidebar-provider'
import { useAppShortcuts } from '@/routing/app-shortcuts'
import { isSettingsPage } from '@/routing/route'
import { useRouter } from '@/routing/router'

interface WorkspaceContentProps {
  graph: GraphInfo
}

/**
 * Everything inside the workspace's providers: two full-height sidebars — the
 * workspace rail on the left, the context rail (details, chat, calendar,
 * browser, terminal) on the right — and between them the content column.
 * Both the content column and the context rail are a 44px band (tab bar /
 * panel switcher) over a floating card with all four corners rounded. A
 * sunken gutter keeps every card off the window's edges so collapsing a
 * rail does not send a sheet flush to the screen; the left rail stays flat,
 * carrying the window's own ground. A collapsed rail unmounts — the layout
 * snaps instead of
 * animating, and panels hosting live surfaces (the embedded browser)
 * release them. The always-mounted global surfaces (⌘K palette, embeddings
 * sync) sit on the window so they still work when Settings covers the frame.
 * Find stays in the note pane. Split from {@link GraphWorkspace} because
 * these hooks need the providers it mounts.
 */
export function WorkspaceContent({ graph }: WorkspaceContentProps): ReactElement {
  const commandContext = useAppShortcuts()
  const { navigate, route } = useRouter()
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
  const settingsPage = isSettingsPage(route)

  return (
    <div className="app-window-ground flex h-screen w-screen flex-col overflow-hidden bg-surface-sunken text-text">
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

      {settingsPage ? (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <RouteContent />
        </div>
      ) : (
        <WorkspaceFrame
          graph={graph}
          commandContext={commandContext}
          contextTarget={contextTarget}
        />
      )}

      <CommandPalette context={commandContext} />
      <ShortcutsDialog />
      <VaultReplaceMount />
      <TemplatePicker context={commandContext} />
      <TemplateCreateDialog context={commandContext} />
      <EmbeddingsSync />
      <AgentRoutinesRunner />
      <TaskRemindersRunner />
    </div>
  )
}

interface WorkspaceFrameProps {
  graph: GraphInfo
  commandContext: CommandContext
  contextTarget: ReturnType<typeof useDailyContextTarget>
}

/**
 * The two-rail workspace around the note pane. Settings is a full-page
 * workspace, not a tab inside this frame.
 */
function WorkspaceFrame({
  graph,
  commandContext,
  contextTarget,
}: WorkspaceFrameProps): ReactElement {
  const { collapsed, contextCollapsed } = useSidebar()
  const panes = usePanes()
  const { columns } = panes
  // A chat tab names its conversation, its route does not: dropping one into
  // another pane has to switch the session first, or the target shows
  // whichever conversation was already open.
  const chatSession = useOptionalChatSession()
  const activeConversationId = chatSession?.activeConversationId ?? null
  const openConversation = chatSession?.openConversation
  // One drag context for every pane: a tab pill dragged out of one strip has
  // to reach the other panes' cards, which only a context above them all
  // sees. The rails keep their own (the sidebar's shelves reorder among
  // themselves), so this one wraps the columns row alone.
  const [dragging, setDragging] = useState(false)
  // The 4px activation distance keeps plain clicks (activate), double clicks
  // (pin) and middle clicks (close) on the pills intact.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const handleDragStart = useCallback(() => {
    setDragging(true)
  }, [])
  const handleDragCancel = useCallback(() => {
    setDragging(false)
  }, [])
  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      setDragging(false)
      // A reorder is the strip's own business (it monitors the same event).
      dropTab(
        resolveTabDrop(event.active, event.over),
        { activeConversationId, openConversation },
        panes,
      )
    },
    [activeConversationId, openConversation, panes],
  )
  const dragState = useMemo(() => ({ dragging }), [dragging])

  return (
    // Every gap in this row is one pane's own left gutter, and the row
    // itself holds the window's right edge open. Nothing here has to know
    // whether its neighbour is mounted, so no gutter is conditional and
    // the `lg` breakpoint the context rail appears at stays the rail's
    // business alone. The workspace rail keeps no gutter: it is flat
    // sunken ground, not a card.
    <div className="workspace-frame flex min-h-0 flex-1 pr-2">
      {collapsed ? undefined : (
        <aside
          id="workspace-sidebar"
          aria-label="Workspace"
          className="app-window-chrome relative flex w-[var(--sidebar-width)] shrink-0 flex-col overflow-hidden bg-surface-sunken"
        >
          <Sidebar graph={graph} context={commandContext} />
          <SidebarResizeHandle panel="workspace" />
        </aside>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={tabDropCollision}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <PaneDragContext value={dragState}>
          {columns.map((column, columnIndex) => (
            <Fragment key={column.id}>
              {columnIndex > 0 ? <PaneResizeHandle axis="columns" /> : null}
              <div data-testid="workspace-column" className="flex min-w-[360px] flex-1 flex-col">
                {column.panes.map((pane, rowIndex) => (
                  <Fragment key={pane.id}>
                    {rowIndex > 0 ? <PaneResizeHandle axis="rows" /> : null}
                    <WorkspacePane
                      pane={pane}
                      commandContext={commandContext}
                      showSidebarToggle={columnIndex === 0 && rowIndex === 0}
                      showContextToggle={columnIndex === columns.length - 1 && rowIndex === 0}
                    />
                  </Fragment>
                ))}
              </div>
            </Fragment>
          ))}
        </PaneDragContext>
      </DndContext>

      {contextCollapsed ? undefined : (
        <aside
          id="context-sidebar"
          aria-label="Context"
          className="app-window-chrome relative hidden w-[var(--context-sidebar-width)] shrink-0 overflow-hidden bg-surface-sunken lg:flex lg:flex-col"
        >
          <SidebarResizeHandle panel="context" />
          <ContextSidebar target={contextTarget} />
        </aside>
      )}
    </div>
  )
}
