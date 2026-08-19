import type { ReactElement } from 'react'
import type { GraphInfo } from '@reflect/core'
import { AppShell } from '@/components/app-shell'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { DailyContextSidebar } from '@/components/context-sidebar/daily-context-sidebar'
import { NoteContextSidebar } from '@/components/context-sidebar/note-context-sidebar'
import type { ContextSidebarTarget } from '@/components/context-sidebar/sidebar-route'
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

/** The context panel for the route's sidebar target, if it gets one. */
function contextSidebarFor(target: ContextSidebarTarget | null): ReactElement | undefined {
  if (target === null) {
    return undefined
  }
  return target.kind === 'daily' ? (
    <DailyContextSidebar date={target.date} />
  ) : (
    <NoteContextSidebar path={target.path} />
  )
}

/**
 * Everything inside the workspace's providers: the sidebar running the full
 * window height on the left, and beside it the content column — the tab bar
 * over a floating note-pane card (all four corners rounded, hairline border,
 * app-background gutter) that holds the note pane and its contextual sidebar.
 * The always-mounted global surfaces (⌘K palette, find bar, embeddings sync)
 * ride inside the card with the route. Split from {@link GraphWorkspace}
 * because these hooks need the providers it mounts.
 */
export function WorkspaceContent({ graph }: WorkspaceContentProps): ReactElement {
  const { collapsed } = useSidebar()
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
            <AppShell
              className="bg-transparent"
              context={collapsed ? undefined : contextSidebarFor(contextTarget)}
              contextEdge={<SidebarResizeHandle panel="context" />}
            >
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
              </div>
            </AppShell>
          </div>
        </div>
      </div>
    </div>
  )
}
