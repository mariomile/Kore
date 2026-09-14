import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Fragment, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'
import { setBridge, type OpenColumn } from '@reflect/core'
import type { CommandContext } from '@/lib/commands/types'
import { zoneDropId } from '@/lib/tab-drop'
import { PanesProvider, usePanes } from '@/providers/panes-provider'
import { SidebarProvider } from '@/providers/sidebar-provider'
import { PaneDragContext } from './pane-drop-zones'
import { PaneResizeHandle } from './pane-resize-handle'
import { WorkspacePane } from './workspace-pane'

/**
 * Two panes side by side: a click anywhere inside one makes it the active
 * pane, which is what the chrome follows. The routed content and the Find
 * bar are stubbed: the pane's own wiring (its router, tab, and Find stores)
 * is what this covers, not what a route renders inside it.
 */

const GRAPH_ROOT = '/g'

const settingsStore = vi.hoisted(() => {
  interface Doc {
    openTabs: Record<string, OpenColumn[]>
  }
  let doc: Doc = { openTabs: {} }
  const listeners = new Set<() => void>()
  return {
    get: (): Doc => doc,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(updater: (current: Doc) => Partial<Doc>): void {
      doc = { ...doc, ...updater(doc) }
      for (const listener of listeners) listener()
    },
    seed(columns: OpenColumn[]): void {
      doc = { openTabs: { [GRAPH_ROOT]: columns } }
      for (const listener of listeners) listener()
    },
  }
})

vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: useSyncExternalStore(settingsStore.subscribe, settingsStore.get),
    updateSettings: () => {},
    updateSettingsWith: settingsStore.update,
  }),
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: GRAPH_ROOT, name: 'g', generation: 1 }, indexing: false }),
}))
vi.mock('@/providers/chat-provider', () => ({ useOptionalChatSession: () => null }))
vi.mock('@/components/route-content', () => ({
  RouteContent: () => <div data-testid="route-content">Route content</div>,
}))
vi.mock('@/components/note-find-bar', () => ({ NoteFindBar: () => null }))

setBridge({
  invoke: async () => [],
  listen: async () => () => {},
})

/** Every capability a command could ask for; the strip's "+" menu never runs one here. */
function stubCommandContext(): CommandContext {
  return {
    navigate: () => {},
    route: () => ({ kind: 'today' }),
    notePath: () => null,
    back: () => {},
    forward: () => {},
    undo: () => {},
    redo: () => {},
    clearScrollState: () => {},
    toggleTheme: () => {},
    toggleSidebar: () => {},
    toggleContextSidebar: () => {},
    newChat: () => 'chat-new',
    openNoteFind: () => {},
    findNextInNote: () => {},
    findPreviousInNote: () => {},
    switchGraph: () => {},
    toggleAudioMemo: () => {},
    generation: () => null,
    graphRoot: () => GRAPH_ROOT,
    openPalette: () => {},
    openShortcuts: () => {},
    openVaultReplace: () => {},
    openTemplatePicker: () => {},
    openTemplateCreate: () => {},
    enableSemanticSearch: () => {},
    summarizeNote: () => {},
    nextTab: () => {},
    previousTab: () => {},
    closeActiveTab: () => {},
    closePane: () => {},
    focusPane: () => {},
  }
}

const COMMAND_CONTEXT = stubCommandContext()

/** The same arrangement `WorkspaceFrame` builds: columns of stacked panes. */
function PaneGrid(): ReactElement {
  const { columns } = usePanes()
  return (
    <div className="flex">
      {columns.map((column, columnIndex) => (
        <Fragment key={column.id}>
          {columnIndex > 0 ? <PaneResizeHandle axis="columns" /> : null}
          <div data-testid="workspace-column" className="flex min-w-[360px] flex-1 flex-col">
            {column.panes.map((pane, rowIndex) => (
              <Fragment key={pane.id}>
                {rowIndex > 0 ? <PaneResizeHandle axis="rows" /> : null}
                <WorkspacePane
                  pane={pane}
                  commandContext={COMMAND_CONTEXT}
                  showSidebarToggle={columnIndex === 0 && rowIndex === 0}
                  showContextToggle={columnIndex === columns.length - 1 && rowIndex === 0}
                />
              </Fragment>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  )
}

function firePointer(element: Element, type: string, init: PointerEventInit): void {
  element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }))
}

/**
 * The frame's drag context, as the strip sees it: the 4px activation distance
 * is what keeps a plain click on a pill a click.
 */
function DragHarness({ children }: { children: ReactNode }): ReactElement {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  return <DndContext sensors={sensors}>{children}</DndContext>
}

/** The same tree, with a drag in flight so every pane shows its zones. */
function renderPanesDragging() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DragHarness>
        <PaneDragContext value={{ dragging: true }}>
          <SidebarProvider>
            <PanesProvider>
              <PaneGrid />
            </PanesProvider>
          </SidebarProvider>
        </PaneDragContext>
      </DragHarness>
    </QueryClientProvider>,
  )
}

function renderPanes() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      {/* Every pane's strip monitors the frame's drag context, and the drop
        zones register in it. */}
      <DragHarness>
        <SidebarProvider>
          <PanesProvider>
            <PaneGrid />
          </PanesProvider>
        </SidebarProvider>
      </DragHarness>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  settingsStore.seed([])
})

const SPLIT_PANES: OpenColumn[] = [
  {
    id: 'main',
    panes: [
      {
        id: 'main',
        tabs: [{ kind: 'surface', surface: 'daily', date: null, pinned: false }],
        activeKey: 'surface:daily',
      },
    ],
  },
  {
    id: 'column-2',
    panes: [
      {
        id: 'pane-2',
        tabs: [{ kind: 'note', path: 'notes/beta.md', pinned: false }],
        activeKey: 'note:notes/beta.md',
      },
    ],
  },
]

/** One column holding two stacked panes: the row axis of the same grid. */
const STACKED_PANES: OpenColumn[] = [
  {
    id: 'main',
    panes: [
      {
        id: 'main',
        tabs: [{ kind: 'surface', surface: 'daily', date: null, pinned: false }],
        activeKey: 'surface:daily',
      },
      {
        id: 'pane-2',
        tabs: [{ kind: 'note', path: 'notes/beta.md', pinned: false }],
        activeKey: 'note:notes/beta.md',
      },
    ],
  },
]

describe('WorkspacePane', () => {
  it('clicking inside a pane makes it the active one', async () => {
    settingsStore.seed(SPLIT_PANES)
    const view = await renderPanes()
    const panes = view.getByTestId('workspace-pane').all()
    expect(panes).toHaveLength(2)

    // The first pane launches active.
    await expect.element(panes[0]!).toHaveAttribute('data-active', 'true')
    expect(panes[1]!.element().getAttribute('data-active')).toBeNull()

    await userEvent.click(panes[1]!)
    await expect.element(panes[1]!).toHaveAttribute('data-active', 'true')
    expect(panes[0]!.element().getAttribute('data-active')).toBeNull()

    await userEvent.click(panes[0]!)
    await expect.element(panes[0]!).toHaveAttribute('data-active', 'true')
    expect(panes[1]!.element().getAttribute('data-active')).toBeNull()

    await view.unmount()
  })

  it('a cancelled resize drag stops following the pointer', async () => {
    settingsStore.seed(SPLIT_PANES)
    const view = await renderPanes()
    const handle = view.getByRole('separator', { name: 'Resize pane' }).element()
    const left = view.getByTestId('workspace-column').all()[0]!.element()

    firePointer(handle, 'pointerdown', { pointerId: 1, isPrimary: true, clientX: 500 })
    firePointer(handle, 'pointermove', { pointerId: 1, clientX: 560 })
    const dragged = left.style.flex
    expect(dragged).not.toBe('')

    // The OS claims the gesture: the column must not keep tracking the
    // pointer across whatever moves come next.
    firePointer(handle, 'pointercancel', { pointerId: 1 })
    firePointer(handle, 'pointermove', { pointerId: 1, clientX: 900 })
    expect(left.style.flex).toBe(dragged)

    await view.unmount()
  })

  it('a cancelled vertical resize drag stops following the pointer', async () => {
    settingsStore.seed(STACKED_PANES)
    const view = await renderPanes()
    const handle = view.getByRole('separator', { name: 'Resize pane' }).element()
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
    const above = view.getByTestId('workspace-pane').all()[0]!.element()

    firePointer(handle, 'pointerdown', { pointerId: 1, isPrimary: true, clientY: 400 })
    firePointer(handle, 'pointermove', { pointerId: 1, clientY: 460 })
    const dragged = above.style.flex
    expect(dragged).not.toBe('')

    firePointer(handle, 'pointercancel', { pointerId: 1 })
    firePointer(handle, 'pointermove', { pointerId: 1, clientY: 900 })
    expect(above.style.flex).toBe(dragged)

    // The handle clamps only the pane it drags. The pane below keeps its own
    // floor, so a divider dragged to the bottom cannot crush it to nothing.
    for (const pane of view.getByTestId('workspace-pane').all()) {
      expect(getComputedStyle(pane.element()).minHeight).toBe('200px')
    }

    await view.unmount()
  })

  it('gives each rail toggle to the one pane nearest its rail', async () => {
    settingsStore.seed(SPLIT_PANES)
    const view = await renderPanes()
    const panes = view.getByTestId('workspace-pane').all()
    expect(panes).toHaveLength(2)

    // Only the two rail labels: "Toggle " also prefixes buttons that belong
    // to the routed content, which say nothing about where the rails are.
    const railLabels = ['Toggle sidebar', 'Toggle context panel']
    const rails = (index: number): string[] =>
      Array.from(
        panes[index]!.element().querySelectorAll('button[aria-label]'),
        (button) => button.getAttribute('aria-label') ?? '',
      ).filter((label) => railLabels.includes(label))
    expect(rails(0)).toEqual(['Toggle sidebar'])
    expect(rails(1)).toEqual(['Toggle context panel'])

    await view.unmount()
  })

  it('shows three drop zones over every pane only while a tab is dragging', async () => {
    settingsStore.seed(SPLIT_PANES)
    const idle = await renderPanes()
    expect(idle.getByTestId('pane-drop-zones').all()).toHaveLength(0)
    await idle.unmount()

    const view = await renderPanesDragging()
    expect(view.getByTestId('pane-drop-zones').all()).toHaveLength(2)
    for (const paneId of ['main', 'pane-2']) {
      for (const zone of ['center', 'right', 'below'] as const) {
        await expect.element(view.getByTestId(zoneDropId(paneId, zone))).toBeInTheDocument()
      }
    }

    await view.unmount()
  })
})
