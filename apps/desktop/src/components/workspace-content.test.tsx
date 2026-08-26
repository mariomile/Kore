import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphInfo } from '@reflect/core'
import type { ContextSidebarTarget } from '@/components/context-sidebar/sidebar-route'

interface WorkspaceState {
  collapsed: boolean
  contextCollapsed: boolean
  target: ContextSidebarTarget | null
}

const workspaceState = vi.hoisted<WorkspaceState>(() => ({
  collapsed: false,
  contextCollapsed: false,
  target: { kind: 'daily', date: '2026-07-11' },
}))
const trafficLights = vi.hoisted(() => ({ inset: false }))

vi.mock('@/components/command-palette/command-palette', () => ({
  CommandPalette: () => null,
}))
vi.mock('@/components/context-sidebar/daily-context-sidebar', () => ({
  DailyContextSidebar: ({ date }: { date: string }) => (
    <div data-testid="daily-context">{date}</div>
  ),
}))
vi.mock('@/components/context-sidebar/note-context-sidebar', () => ({
  NoteContextSidebar: ({ path }: { path: string }) => <div data-testid="note-context">{path}</div>,
}))
vi.mock('@/components/embeddings-sync', () => ({ EmbeddingsSync: () => null }))
vi.mock('@/components/agent-routines-runner', () => ({ AgentRoutinesRunner: () => null }))
vi.mock('@/components/task-reminders-runner', () => ({ TaskRemindersRunner: () => null }))
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
vi.mock('@/components/shortcuts-dialog', () => ({ ShortcutsDialog: () => null }))
vi.mock('@/components/sidebar/sidebar', () => ({
  Sidebar: () => <div data-testid="workspace-sidebar" />,
}))
vi.mock('@/components/templates/template-create-dialog', () => ({
  TemplateCreateDialog: () => null,
}))
vi.mock('@/components/templates/template-picker', () => ({ TemplatePicker: () => null }))
vi.mock('@/providers/focused-daily-provider', () => ({
  useDailyContextTarget: () => workspaceState.target,
}))
vi.mock('@/providers/sidebar-provider', () => ({
  useSidebar: () => ({
    collapsed: workspaceState.collapsed,
    toggleSidebar: vi.fn(),
    contextCollapsed: workspaceState.contextCollapsed,
    toggleContextSidebar: vi.fn(),
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
  useRouter: () => ({ navigate: vi.fn() }),
}))

const { WorkspaceContent } = await import('./workspace-content')

const GRAPH: GraphInfo = { root: '/notes', name: 'Notes', generation: 1 }

beforeEach(async () => {
  workspaceState.collapsed = false
  workspaceState.contextCollapsed = false
  workspaceState.target = { kind: 'daily', date: '2026-07-11' }
  trafficLights.inset = false
  // The context sidebar is `hidden lg:block`, so it only renders on a
  // desktop-width viewport.
  await page.viewport(1280, 800)
})

afterEach(async () => {
  await page.viewport(900, 600)
})

describe('WorkspaceContent', () => {
  it('collapses each rail independently and restores it', async () => {
    const view = await render(<WorkspaceContent graph={GRAPH} />)

    await expect.element(view.getByRole('complementary', { name: 'Workspace' })).toBeInTheDocument()
    await expect.element(view.getByRole('complementary', { name: 'Context' })).toBeInTheDocument()
    expect(view.getByTestId('daily-context').element().textContent).toBe('2026-07-11')

    // Hiding the left rail leaves the right one standing…
    workspaceState.collapsed = true
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    expect(view.getByRole('complementary', { name: 'Workspace' }).query()).toBeNull()
    await expect.element(view.getByRole('complementary', { name: 'Context' })).toBeInTheDocument()

    // …and vice versa; both hidden still leaves the sunken gutter around
    // the note pane so the sheet does not go edge-to-edge.
    workspaceState.collapsed = false
    workspaceState.contextCollapsed = true
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    await expect.element(view.getByRole('complementary', { name: 'Workspace' })).toBeInTheDocument()
    expect(view.getByRole('complementary', { name: 'Context' }).query()).toBeNull()

    workspaceState.collapsed = true
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    expect(view.getByRole('complementary', { name: 'Workspace' }).query()).toBeNull()
    expect(view.getByRole('complementary', { name: 'Context' }).query()).toBeNull()

    workspaceState.collapsed = false
    workspaceState.contextCollapsed = false
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    await expect.element(view.getByRole('complementary', { name: 'Workspace' })).toBeInTheDocument()
    await expect.element(view.getByRole('complementary', { name: 'Context' })).toBeInTheDocument()
  })

  it('collapsing the context rail hides ordinary note context too', async () => {
    workspaceState.target = { kind: 'note', path: 'notes/project.md' }
    const view = await render(<WorkspaceContent graph={GRAPH} />)
    expect(view.getByTestId('note-context').element().textContent).toBe('notes/project.md')

    workspaceState.contextCollapsed = true
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    expect(view.getByRole('complementary', { name: 'Context' }).query()).toBeNull()
  })

  it('keeps the sunken gutter around the note pane when both rails collapse', async () => {
    workspaceState.collapsed = true
    workspaceState.contextCollapsed = true
    const view = await render(<WorkspaceContent graph={GRAPH} />)

    const gutter = view.getByTestId('note-pane-gutter').element()
    const style = getComputedStyle(gutter)
    expect(style.paddingLeft).toBe('8px')
    expect(style.paddingRight).toBe('8px')
    expect(style.paddingBottom).toBe('8px')
  })

  it('reserves the traffic-light band only while the lights occupy the top', async () => {
    const view = await render(<WorkspaceContent graph={GRAPH} />)
    expect(view.getByTestId('macos-traffic-light-band').query()).toBeNull()

    trafficLights.inset = true
    await view.rerender(<WorkspaceContent graph={GRAPH} />)
    await expect.element(view.getByTestId('macos-traffic-light-band')).toBeInTheDocument()
  })
})
