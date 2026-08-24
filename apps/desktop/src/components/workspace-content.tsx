import type { ReactElement } from 'react'
import type { GraphInfo } from '@reflect/core'
import { AppShell } from '@/components/app-shell'
import { cn } from '@/lib/utils'
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
      <aside
        id="workspace-sidebar"
        aria-label="Workspace"
        aria-hidden={collapsed}
        {...(collapsed ? { inert: true } : {})}
        className={cn(
          'relative flex shrink-0 flex-col overflow-hidden bg-surface-sunken',
          'transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
        )}
        style={{ width: collapsed ? 0 : 'var(--sidebar-width)' }}
      >
        <div className="flex h-full w-[var(--sidebar-width)] min-w-[var(--sidebar-width)] flex-col">
          <Sidebar graph={graph} context={commandContext} />
        </div>
        {collapsed ? null : <SidebarResizeHandle panel="workspace" />}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <NoteTabsStrip atWindowEdge={collapsed} commandContext={commandContext} />
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

      <aside
        id="context-sidebar"
        aria-label="Context"
        aria-hidden={contextCollapsed}
        {...(contextCollapsed ? { inert: true } : {})}
        className={cn(
          'relative hidden shrink-0 overflow-hidden bg-surface-sunken lg:flex lg:flex-col',
          'transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
        )}
        style={{ width: contextCollapsed ? 0 : 'var(--context-sidebar-width)' }}
      >
        {contextCollapsed ? null : <SidebarResizeHandle panel="context" />}
        <div className="flex h-full w-[var(--context-sidebar-width)] min-w-[var(--context-sidebar-width)] flex-col">
          <ContextSidebar target={contextTarget} />
        </div>
      </aside>
    </div>
  )
}
