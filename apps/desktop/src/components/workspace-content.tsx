import { Fragment, memo, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { subscribeBrowserNavigated, type GraphInfo } from '@kore/core'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { ContextCollapsedRail } from '@/components/context-sidebar/context-collapsed-rail'
import { ContextSidebar } from '@/components/context-sidebar/context-sidebar'
import { AgentRoutinesRunner } from '@/components/agent-routines-runner'
import { RemoteAccessRunner } from '@/components/remote-access-runner'
import { TaskRemindersRunner } from '@/components/task-reminders-runner'
import { EmbeddingsSync } from '@/components/embeddings-sync'
import { BeneathSettings, SettingsModal } from '@/components/settings-modal'
import { VaultCompatNotice } from '@/components/vault-compat/vault-compat-notice'
import { VaultReplaceMount } from '@/components/vault-replace/vault-replace-dialog'
import { ShortcutsDialog } from '@/components/shortcuts-dialog'
import { Sidebar } from '@/components/sidebar/sidebar'
import { SidebarCollapsedRail } from '@/components/sidebar/sidebar-collapsed-rail'
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
import { cn } from '@/lib/utils'
import { useOptionalChatSession } from '@/providers/chat-provider'
import { useDailyContextTarget } from '@/providers/focused-daily-provider'
import { usePanes } from '@/providers/panes-provider'
import { useSidebar } from '@/providers/sidebar-provider'
import { useAppShortcuts } from '@/routing/app-shortcuts'
import { useRouter } from '@/routing/router'
import { DragHaptics } from '@/components/drag-haptics'

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
 * carrying the window's own ground. A collapsed rail unmounts, so panels
 * hosting live surfaces (the embedded browser) release them; the layout
 * changes in one step and the arriving rail fades in from its window edge
 * (`kore-rail-in-*`, transform and opacity only). The always-mounted global surfaces (⌘K palette, embeddings
 * sync) sit on the window, beside the Settings modal that floats over the frame.
 * Find stays in the note pane. Split from {@link GraphWorkspace} because
 * these hooks need the providers it mounts.
 */
export function WorkspaceContent({ graph }: WorkspaceContentProps): ReactElement {
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
  const trafficLightBand = useMacosTrafficLightInset()

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

      {/* Settings floats over the workspace as a modal, so the frame stays
          mounted beneath it showing where the user came from. */}
      <BeneathSettings>
        <WorkspaceFrame graph={graph} commandContext={commandContext} />
      </BeneathSettings>
      <SettingsModal />

      <CommandPalette context={commandContext} />
      <ShortcutsDialog />
      <VaultReplaceMount />
      <TemplatePicker context={commandContext} />
      <TemplateCreateDialog context={commandContext} />
      <EmbeddingsSync />
      <AgentRoutinesRunner />
      <TaskRemindersRunner />
      <RemoteAccessRunner />
      <VaultCompatNotice graph={graph} />
    </div>
  )
}

interface WorkspaceFrameProps {
  graph: GraphInfo
  commandContext: CommandContext
}

/**
 * Isolates the right context rail's subscriptions (`useRouter`,
 * `useDailyContextTarget`) from `WorkspaceFrame`, so moving focus between
 * days in the daily stream or switching routes never re-renders the left
 * sidebar (Folders/Tags trees), `DndContext`, or workspace panes.
 */
function ContextRailSlot({ collapsed }: { collapsed: boolean }): ReactElement {
  const { route } = useRouter()
  const contextTarget = useDailyContextTarget()
  if (collapsed) {
    return (
      <nav
        aria-label="Context rail"
        data-testid="context-collapsed-rail"
        className="app-window-chrome kore-rail-in-end ml-2 hidden w-11 shrink-0 bg-surface-sunken lg:flex lg:flex-col"
      >
        <ContextCollapsedRail showDetails routeKind={route.kind} />
      </nav>
    )
  }
  return (
    <aside
      id="context-sidebar"
      aria-label="Context"
      className="app-window-chrome kore-rail-in-end relative hidden w-[var(--context-sidebar-width)] shrink-0 overflow-hidden bg-surface-sunken lg:flex lg:flex-col"
    >
      <SidebarResizeHandle panel="context" />
      <ContextSidebar target={contextTarget} showDetails routeKind={route.kind} />
    </aside>
  )
}

/**
 * The two-rail workspace around the note pane. Settings is a modal over this
 * frame, not a tab inside it. Memoized so modal/shortcut state updates in
 * `WorkspaceContent` never cascade across the entire workspace tree.
 */
const WorkspaceFrame = memo(function WorkspaceFrame({
  graph,
  commandContext,
}: WorkspaceFrameProps): ReactElement {
  const { collapsed, contextCollapsed, setContextRailAvailable } = useSidebar()
  // The rail is available on every route (Mario, 2026-11-17: "la right
  // sidebar deve essere sempre disponibile"). Details describes the note,
  // the day, the peeked row or the chat's context, and offers the other
  // panels where a page has nothing of its own to describe.
  useEffect(() => {
    setContextRailAvailable(true)
    // A graph switch unmounts the frame, rail and all.
    return () => setContextRailAvailable(false)
  }, [setContextRailAvailable])
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
    <div
      className={cn(
        'workspace-frame flex min-h-0 flex-1',
        contextCollapsed ? 'pr-2 lg:pr-0' : 'pr-2',
      )}
    >
      {collapsed ? (
        <nav
          aria-label="Workspace rail"
          data-testid="workspace-collapsed-rail"
          className="app-window-chrome kore-rail-in-start flex w-11 shrink-0 flex-col bg-surface-sunken"
        >
          <SidebarCollapsedRail graph={graph} context={commandContext} />
        </nav>
      ) : (
        <aside
          id="workspace-sidebar"
          aria-label="Workspace"
          className="app-window-chrome kore-rail-in-start relative flex w-[var(--sidebar-width)] shrink-0 flex-col overflow-hidden bg-surface-sunken"
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
        <DragHaptics />
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
                      showSidebarToggle={!collapsed && columnIndex === 0 && rowIndex === 0}
                      showContextToggle={columnIndex === columns.length - 1 && rowIndex === 0}
                    />
                  </Fragment>
                ))}
              </div>
            </Fragment>
          ))}
        </PaneDragContext>
      </DndContext>

      <ContextRailSlot collapsed={contextCollapsed} />
    </div>
  )
})
