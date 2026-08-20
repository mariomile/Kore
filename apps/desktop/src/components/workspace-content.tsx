import type { ReactElement } from 'react'
import type { GraphInfo } from '@reflect/core'
import { AppShell } from '@/components/app-shell'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { ContextSidebar } from '@/components/context-sidebar/context-sidebar'
import { AgentRoutinesRunner } from '@/components/agent-routines-runner'
import { EmbeddingsSync } from '@/components/embeddings-sync'
import { NoteFindBar } from '@/components/note-find-bar'
import { NoteTabsStrip } from '@/components/note-tabs-strip'
import { RouteContent } from '@/components/route-content'
import { ShortcutsDialog } from '@/components/shortcuts-dialog'
import { Sidebar } from '@/components/sidebar/sidebar'
import { SidebarResizeHandle } from '@/components/sidebar-resize-handle'
import { TemplateCreateDialog } from '@/components/templates/template-create-dialog'
import { TemplatePicker } from '@/components/templates/template-picker'
import { useDailyContextTarget } from '@/providers/focused-daily-provider'
import { useSidebar } from '@/providers/sidebar-provider'
import { useAppShortcuts } from '@/routing/app-shortcuts'

interface WorkspaceContentProps {
  graph: GraphInfo
}

/**
 * Everything inside the workspace's providers: two full-height sidebars — the
 * workspace rail on the left, the context rail (details, chat, calendar) on
 * the right — and between them the content column: the tab bar over a
 * floating note-pane card with all four corners rounded, a hairline border,
 * and the app background as its gutter. The always-mounted global surfaces
 * (⌘K palette, find bar, embeddings sync) ride inside the card with the
 * route. Split from {@link GraphWorkspace} because these hooks need the
 * providers it mounts.
 */
export function WorkspaceContent({ graph }: WorkspaceContentProps): ReactElement {
  const { collapsed, contextCollapsed } = useSidebar()
  const commandContext = useAppShortcuts()
  // Daily routes get the day's contextual panel and note routes the note's;
  // search/settings get none (AppShell omits the region when context is absent).
  // In the daily stream the route stays put while focus moves between days, so
  // the panel follows the focused day and snaps back on navigation.
  const contextTarget = useDailyContextTarget()

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-app text-text">
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
        <NoteTabsStrip atWindowEdge={collapsed} />
        <div className="min-h-0 flex-1 px-2 pb-2">
          <div className="h-full overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <AppShell className="bg-transparent">
              <div className="relative flex h-full flex-col">
                <div className="min-h-0 flex-1">
                  <RouteContent />
                </div>

                <NoteFindBar />
                <CommandPalette context={commandContext} />
                <ShortcutsDialog />
                <TemplatePicker context={commandContext} />
                <TemplateCreateDialog context={commandContext} />
                <EmbeddingsSync />
                <AgentRoutinesRunner />
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
  )
}
