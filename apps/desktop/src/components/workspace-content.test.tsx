import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { GraphInfo } from '@kore/core'
import type { ContextPanel } from '@/components/context-sidebar/context-panel'
import type { ContextSidebarTarget } from '@/components/context-sidebar/sidebar-route'
import type { Route } from '@/routing/route'

interface WorkspaceState {
  collapsed: boolean
  contextCollapsed: boolean
  target: ContextSidebarTarget | null
  openedPanels: ContextPanel[]
}

const workspaceState = vi.hoisted<WorkspaceState>(() => ({
  collapsed: false,
  contextCollapsed: false,
  target: { kind: 'daily', date: '2026-07-11' },
  openedPanels: [],
}))
const trafficLights = vi.hoisted(() => ({ inset: false }))
const routerState = vi.hoisted(() => ({
  route: { kind: 'today' } as Route,
  navigate: vi.fn(),
}))

vi.mock('@/components/command-palette/command-palette', () => ({
  CommandPalette: () => null,
}))
vi.mock('@/components/context-sidebar/daily-context-sidebar', () => ({
  DailyContextSidebar: ({ date }: { date: string }) => (
    <div data-testid="daily-context">{date}</div>
  ),
}))
vi.mock('@/components/context-sidebar/day-calendar', () => ({
  DayCalendar: () => <div data-testid="day-calendar" />,
}))
vi.mock('@/components/context-sidebar/daily-events-section', () => ({
  DailyEventsSection: () => null,
}))
vi.mock('@/components/context-sidebar/note-context-sidebar', () => ({
  NoteContextSidebar: ({ path }: { path: string }) => <div data-testid="note-context">{path}</div>,
}))
vi.mock('@/components/embeddings-sync', () => ({ EmbeddingsSync: () => null }))
vi.mock('@/components/agent-routines-runner', () => ({ AgentRoutinesRunner: () => null }))
vi.mock('@/components/task-reminders-runner', () => ({ TaskRemindersRunner: () => null }))
vi.mock('@/components/remote-access-runner', () => ({ RemoteAccessRunner: () => null }))
vi.mock('@/components/vault-compat/vault-compat-notice', () => ({ VaultCompatNotice: () => null }))
vi.mock('@/components/note-find-bar', () => ({ NoteFindBar: () => null }))
vi.mock('@/components/vault-replace/vault-replace-dialog', () => ({
  VaultReplaceMount: () => null,
}))
// The tab strip pulls the open-tabs stack (graph, palette, index queries) —
// its own test covers it; here only the frame around it is under test.
vi.mock('@/components/note-tabs-strip', () => ({ WorkspaceTabsStrip: () => null }))
vi.mock('@/lib/use-macos-traffic-light-inset', () => ({
  useMacosTrafficLightInset: () => trafficLights.inset,
}))
vi.mock('@/components/route-content', () => ({ RouteContent: () => <div>Route content</div> }))
// The modal and the router pin beneath it are `settings-modal.test.tsx`'s
// subject; here only where the frame mounts them is under test.
vi.mock('@/components/settings-modal', () => ({
  BeneathSettings: ({ children }: { children: ReactNode }) => children,
  SettingsModal: () =>
    routerState.route.kind === 'settings' ? <div role="dialog" aria-label="Settings" /> : null,
}))
vi.mock('@/components/shortcuts-dialog', () => ({ ShortcutsDialog: () => null }))
vi.mock('@/components/sidebar/sidebar', () => ({
  Sidebar: () => <div data-testid="workspace-sidebar" />,
}))
vi.mock('@/components/sidebar/sidebar-collapsed-rail', () => ({
  SidebarCollapsedRail: () => <div data-testid="workspace-collapsed-rail-inner" />,
}))
vi.mock('@/components/templates/template-create-dialog', () => ({
  TemplateCreateDialog: () => null,
}))
vi.mock('@/components/templates/template-picker', () => ({ TemplatePicker: () => null }))
vi.mock('@/providers/focused-daily-provider', () => ({
  useDailyContextTarget: () => workspaceState.target,
  FocusedDailyProvider: ({ children }: { children: ReactNode }) => children,
  FocusedDailyArrivalReset: () => null,
}))
// The pane row is `workspace-pane.test.tsx`'s subject; here only the frame
// around it is under test, so one stub pane stands in for the model and the
// per-pane providers the real pane mounts.
vi.mock('@/providers/panes-provider', () => ({
  usePanes: () => ({
    panes: [{ id: 'main' }],
    columns: [{ id: 'main', panes: [{ id: 'main' }] }],
    activePane: { id: 'main' },
    setActivePane: vi.fn(),
    moveTab: vi.fn(),
  }),
  useOptionalPanes: () => null,
  usePaneId: () => 'main',
  useScopedPaneId: () => 'main',
  PaneScope: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/providers/open-tabs-provider', () => ({
  OpenTabsProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/providers/note-find-provider', () => ({
  NoteFindProvider: ({ children }: { children: ReactNode }) => children,
}))
const setContextRailAvailable = vi.hoisted(() => vi.fn<(available: boolean) => void>())
vi.mock('@/providers/sidebar-provider', () => ({
  useSidebar: () => ({
    collapsed: workspaceState.collapsed,
    toggleSidebar: vi.fn(),
    contextCollapsed: workspaceState.contextCollapsed,
    toggleContextSidebar: vi.fn(),
    contextPanels: { opened: workspaceState.openedPanels, active: 'details' },
    openContextPanel: vi.fn(),
    closeContextPanel: vi.fn(),
    setContextRailAvailable,
  }),
}))
// The asides mount resize handles, which read the persisted widths. The
// query key rides along for modules deeper in the import graph (graph boot).
vi.mock('@/providers/settings-provider', () => ({
  SETTINGS_QUERY_KEY: ['settings'],
  useSettings: () => ({
    settings: { sidebarWidth: 260, contextSidebarWidth: 320 },
    updateSettings: vi.fn(),
    updateSettingsWith: vi.fn(),
  }),
}))
vi.mock('@/routing/app-shortcuts', () => ({ useAppShortcuts: () => ({}) }))
// The frame registers the in-app browser opener with the router; the frame
// test runs without a RouterProvider.
vi.mock('@/routing/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/routing/router')>()),
  useRouter: () => routerState,
}))

const { WorkspaceContent } = await import('./workspace-content')

const GRAPH: GraphInfo = { root: '/notes', name: 'Notes', generation: 1 }

beforeEach(async () => {
  workspaceState.collapsed = false
  workspaceState.contextCollapsed = false
  workspaceState.target = { kind: 'daily', date: '2026-07-11' }
  workspaceState.openedPanels = []
  trafficLights.inset = false
  routerState.route = { kind: 'today' }
  // The context sidebar is `hidden lg:block`, so it only renders on a
  // desktop-width viewport.
  await page.viewport(1280, 800)
})

afterEach(async () => {
  document.documentElement.removeAttribute('data-visual-theme')
  document.documentElement.removeAttribute('data-theme')
  await page.viewport(900, 600)
})

describe('WorkspaceContent', () => {
  it('makes Flat panels square and flush with the bottom and right window edges', async () => {
    document.documentElement.setAttribute('data-visual-theme', 'flat')
    document.documentElement.setAttribute('data-theme', 'midnight')
    const view = await render(<WorkspaceContent graph={GRAPH} />)
    const note = view.getByTestId('note-pane-gutter').element().firstElementChild!
    const context = view.getByTestId('context-pane-gutter').element().firstElementChild!
    expect(getComputedStyle(note).borderRadius).toBe('0px')
    expect(getComputedStyle(context).borderRadius).toBe('0px')
    expect(getComputedStyle(document.querySelector('.workspace-main')!).backgroundColor).toBe(
      'rgb(10, 10, 10)',
    )
    expect(
      getComputedStyle(view.getByRole('complementary', { name: 'Context' }).element())
        .borderLeftWidth,
    ).toBe('0px')
    expect(note.getBoundingClientRect().bottom).toBe(window.innerHeight)
    expect(context.getBoundingClientRect().bottom).toBe(window.innerHeight)
    expect(context.getBoundingClientRect().right).toBe(window.innerWidth)
    expect(note.getBoundingClientRect().right).toBe(
      view.getByRole('complementary', { name: 'Context' }).element().getBoundingClientRect().left,
    )
  })

  it('collapses each rail independently and restores it', async () => {
    const view = await render(<WorkspaceContent graph={GRAPH} />)

    await expect.element(view.getByRole('complementary', { name: 'Workspace' })).toBeInTheDocument()
    await expect.element(view.getByRole('complementary', { name: 'Context' })).toBeInTheDocument()
    expect(view.getByTestId('daily-context').element().textContent).toBe('2026-07-11')

    // Hiding the left rail swaps it for the collapsed icon strip while leaving
    // the right rail standing…
    workspaceState.collapsed = true
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    expect(view.getByRole('complementary', { name: 'Workspace' }).query()).toBeNull()
    await expect.element(view.getByTestId('workspace-collapsed-rail')).toBeInTheDocument()
    await expect.element(view.getByRole('complementary', { name: 'Context' })).toBeInTheDocument()

    // …and vice versa; both hidden swap to their slim icon strips.
    workspaceState.collapsed = false
    workspaceState.contextCollapsed = true
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    await expect.element(view.getByRole('complementary', { name: 'Workspace' })).toBeInTheDocument()
    expect(view.getByRole('complementary', { name: 'Context' }).query()).toBeNull()
    await expect.element(view.getByTestId('context-collapsed-rail')).toBeInTheDocument()

    workspaceState.collapsed = true
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    expect(view.getByRole('complementary', { name: 'Workspace' }).query()).toBeNull()
    expect(view.getByRole('complementary', { name: 'Context' }).query()).toBeNull()
    await expect.element(view.getByTestId('workspace-collapsed-rail')).toBeInTheDocument()
    await expect.element(view.getByTestId('context-collapsed-rail')).toBeInTheDocument()

    workspaceState.collapsed = false
    workspaceState.contextCollapsed = false
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    await expect.element(view.getByRole('complementary', { name: 'Workspace' })).toBeInTheDocument()
    await expect.element(view.getByRole('complementary', { name: 'Context' })).toBeInTheDocument()
    expect(view.getByTestId('workspace-collapsed-rail').query()).toBeNull()
    expect(view.getByTestId('context-collapsed-rail').query()).toBeNull()
  })

  it('collapsing the context rail hides ordinary note context too', async () => {
    workspaceState.target = { kind: 'note', path: 'notes/project.md' }
    const view = await render(<WorkspaceContent graph={GRAPH} />)
    expect(view.getByTestId('note-context').element().textContent).toBe('notes/project.md')

    workspaceState.contextCollapsed = true
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    expect(view.getByRole('complementary', { name: 'Context' }).query()).toBeNull()
    expect(view.getByTestId('note-context').query()).toBeNull()
  })

  it('keeps the context rail available on every route, chat and Graph included', async () => {
    workspaceState.target = null
    for (const route of [
      { kind: 'graphMap' },
      { kind: 'chat' },
      { kind: 'tasks' },
      { kind: 'allNotes', filter: { kind: 'all' } },
    ] as const) {
      routerState.route = route
      const view = await render(<WorkspaceContent graph={GRAPH} />)
      await expect.element(view.getByRole('complementary', { name: 'Context' })).toBeInTheDocument()
      await view.unmount()
    }
  })

  it('tells the context toggle the rail is there, and that it is gone on unmount', async () => {
    workspaceState.target = null
    routerState.route = { kind: 'graphMap' }
    const view = await render(<WorkspaceContent graph={GRAPH} />)
    expect(setContextRailAvailable).toHaveBeenLastCalledWith(true)

    await view.unmount()
    expect(setContextRailAvailable).toHaveBeenLastCalledWith(false)
  })

  it('keeps balanced sunken gutters beside the collapsed icon rails', async () => {
    workspaceState.collapsed = true
    workspaceState.contextCollapsed = true
    const view = await render(<WorkspaceContent graph={GRAPH} />)

    const card = view.getByTestId('note-pane-gutter').element().firstElementChild
    const leftRail = view.getByTestId('workspace-collapsed-rail').element()
    const rightRail = view.getByTestId('context-collapsed-rail').element()
    const cardRect = card!.getBoundingClientRect()
    const leftRect = leftRail.getBoundingClientRect()
    const rightRect = rightRail.getBoundingClientRect()
    expect(Math.round(leftRect.left)).toBe(0)
    expect(Math.round(cardRect.left - leftRect.right)).toBe(8)
    expect(Math.round(rightRect.left - cardRect.right)).toBe(8)
    expect(Math.round(window.innerWidth - rightRect.right)).toBe(0)
    expect(Math.round(window.innerHeight - cardRect.bottom)).toBe(8)
  })

  it('reserves the traffic-light band only while the lights occupy the top', async () => {
    const view = await render(<WorkspaceContent graph={GRAPH} />)
    expect(view.getByTestId('macos-traffic-light-band').query()).toBeNull()

    trafficLights.inset = true
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    await expect.element(view.getByTestId('macos-traffic-light-band')).toBeInTheDocument()
  })

  it('floats Settings over the workspace instead of replacing it', async () => {
    routerState.route = { kind: 'settings' }
    const view = await render(<WorkspaceContent graph={GRAPH} />)

    await expect.element(page.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    await expect.element(view.getByRole('complementary', { name: 'Workspace' })).toBeInTheDocument()
    await expect.element(view.getByTestId('note-pane-gutter')).toBeInTheDocument()
  })
})
