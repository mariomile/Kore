import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type Activators,
  type DragEndEvent,
  type SensorInstance,
  type SensorOptions,
  type SensorProps,
} from '@dnd-kit/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import {
  Fragment,
  useCallback,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'
import { setBridge, type OpenColumn } from '@reflect/core'
import type { CommandContext } from '@/lib/commands/types'
import { dropTab, resolveTabDrop, zoneDropId } from '@/lib/tab-drop'
import { tabDropCollision } from '@/lib/tab-drop-collision'
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
/**
 * The routed view, reduced to the one behaviour that matters here: a note
 * route focuses its editor when the pane arrives on it. The stand-in latches
 * the same rule `SingleNoteView` does, namely that an arrival takes the caret
 * only when its pane is the active one, so a pane that focuses out of turn
 * shows up as the wrong pane ending active, exactly as it does in the app.
 */
vi.mock('@/components/route-content', async () => {
  const { useEffect, useRef, useState } = await import('react')
  const { usePaneIsActive } = await import('@/providers/panes-provider')
  const { useRouter } = await import('@/routing/router')
  function RouteContent(): ReactElement {
    const editor = useRef<HTMLInputElement>(null)
    const { arrivalSeq } = useRouter()
    const paneIsActive = usePaneIsActive()
    const [arrival, setArrival] = useState({ seq: arrivalSeq, focus: paneIsActive })
    if (arrival.seq !== arrivalSeq) {
      setArrival({ seq: arrivalSeq, focus: paneIsActive })
    }
    useEffect(() => {
      if (arrival.focus) {
        editor.current?.focus()
      }
    }, [arrival])
    return <input ref={editor} data-testid="route-content" readOnly value="Route content" />
  }
  return { RouteContent }
})
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
    moveActiveTab: () => {},
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

/** Viewport coordinates, the shape dnd-kit's sensors speak in. */
interface Point {
  x: number
  y: number
}

interface DragControl {
  move(coordinates: Point): void
  end(): void
}

/**
 * The drag the test drives. dnd-kit's own PointerSensor ignores synthetic
 * `pointermove` events in this harness, so the drag is steered through a
 * sensor of our own: it starts on `pointerdown` where the pointer is and
 * hands the test the two calls dnd-kit would otherwise make from real
 * pointer events. Everything downstream (measuring, collision, `onDragEnd`,
 * the strip's monitor) is the real thing.
 */
let dragControl: DragControl | null = null
/** What dnd-kit currently reports the drag is over, as ids, live. */
let dragOverId: string | null = null

class TestDragSensor implements SensorInstance {
  autoScrollEnabled = false

  static activators: Activators<SensorOptions> = [
    { eventName: 'onPointerDown', handler: () => true },
  ]

  constructor(props: SensorProps<SensorOptions>) {
    const { event } = props
    dragControl = {
      move: (coordinates) => {
        props.onMove(coordinates)
      },
      end: () => {
        props.onEnd()
      },
    }
    props.onStart(
      event instanceof PointerEvent ? { x: event.clientX, y: event.clientY } : { x: 0, y: 0 },
    )
  }
}

/** The frame's drag wiring: the same collision, resolver and pane call. */
function DragFrame({ children }: { children: ReactNode }): ReactElement {
  const panes = usePanes()
  const [dragging, setDragging] = useState(false)
  const sensors = useSensors(useSensor(TestDragSensor))
  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      setDragging(false)
      dropTab(
        resolveTabDrop(event.active, event.over),
        { activeConversationId: null, openConversation: undefined },
        panes,
      )
    },
    [panes],
  )
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={tabDropCollision}
      onDragStart={() => {
        setDragging(true)
      }}
      onDragOver={(event) => {
        dragOverId = event.over === null ? null : String(event.over.id)
      }}
      onDragCancel={() => {
        setDragging(false)
      }}
      onDragEnd={handleDragEnd}
    >
      <PaneDragContext value={{ dragging }}>{children}</PaneDragContext>
    </DndContext>
  )
}

function renderDragFrame() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <PanesProvider>
          <DragFrame>
            <PaneGrid />
          </DragFrame>
        </PanesProvider>
      </SidebarProvider>
    </QueryClientProvider>,
  )
}

/** Press the pill, then let the caller steer the drag from its centre. */
function startDrag(pill: Element): DragControl {
  dragOverId = null
  const rect = pill.getBoundingClientRect()
  firePointer(pill, 'pointerdown', {
    pointerId: 3,
    isPrimary: true,
    button: 0,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  })
  if (dragControl === null) {
    throw new Error('the drag never started')
  }
  return dragControl
}

/**
 * Move the pointer to the middle of `target` and wait until dnd-kit agrees
 * the drag is over `expected`: `over` is settled a render after the move, and
 * dropping before then would end the drag over nothing.
 */
async function dragOver(drag: DragControl, target: Element, expected: string): Promise<void> {
  const rect = target.getBoundingClientRect()
  drag.move({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  await vi.waitFor(() => {
    expect(dragOverId).toBe(expected)
  })
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

/** A control outside every pane, so pressing it activates no pane by itself. */
function MoveTabDownButton(): ReactElement {
  const { moveActiveTab } = usePanes()
  return (
    <button
      type="button"
      onClick={() => {
        moveActiveTab('down')
      }}
    >
      Move tab down
    </button>
  )
}

/** The same tree, plus the command that moves the active tab into a split. */
function renderMovableFrame() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DragHarness>
        <SidebarProvider>
          <PanesProvider>
            <MoveTabDownButton />
            <PaneGrid />
          </PanesProvider>
        </SidebarProvider>
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

/**
 * One pane holding two tabs: the strip a reorder rearranges. Both are
 * surfaces, because a note tab whose file the index cannot resolve is pruned
 * from the strip (`useOpenTabItems`), and this suite's bridge resolves none.
 */
const TWO_TAB_PANE: OpenColumn[] = [
  {
    id: 'main',
    panes: [
      {
        id: 'main',
        tabs: [
          { kind: 'surface', surface: 'daily', date: null, pinned: false },
          { kind: 'surface', surface: 'tasks', pinned: false },
        ],
        activeKey: 'surface:daily',
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
    const handle = view.getByRole('separator', { name: 'Resize columns' }).element()
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
    const handle = view.getByRole('separator', { name: 'Resize rows' }).element()
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

  it("drops a pill on another pane's below zone and the tab moves into a new pane", async () => {
    settingsStore.seed(SPLIT_PANES)
    const view = await renderDragFrame()
    const panes = view.getByTestId('workspace-pane').all()
    const pill = panes[0]!.element().querySelector('[role="tab"]')!

    const drag = startDrag(pill)
    await vi.waitFor(() => {
      expect(view.getByTestId('pane-drop-zones').all()).toHaveLength(2)
    })
    const zone = view.getByTestId(zoneDropId('pane-2', 'below')).element()
    await dragOver(drag, zone, zoneDropId('pane-2', 'below'))
    // The zone under the pointer says so.
    expect(zone.className).toContain('ring-accent')
    drag.end()

    await vi.waitFor(() => {
      const columns = settingsStore.get().openTabs[GRAPH_ROOT] ?? []
      // The source gave up its only tab, so its column went with it; the
      // dragged tab opened a new pane under the one it landed on.
      expect(columns).toHaveLength(1)
      expect(columns[0]!.panes.map((pane) => pane.tabs.map((tab) => tab.kind))).toEqual([
        ['note'],
        ['surface'],
      ])
    })

    await view.unmount()
  })

  it('moving the active tab down leaves the new pane active and focused', async () => {
    settingsStore.seed(TWO_TAB_PANE)
    const view = await renderMovableFrame()
    expect(view.getByTestId('workspace-pane').all()).toHaveLength(1)

    // Outside every pane, so pressing it changes no pane's activation itself.
    await userEvent.click(view.getByRole('button', { name: 'Move tab down' }))

    await vi.waitFor(() => {
      expect(view.getByTestId('workspace-pane').all()).toHaveLength(2)
    })
    const panes = view.getByTestId('workspace-pane').all()
    // The source survives on its remaining tab and re-navigates to it. Its
    // arrival must not pull the caret, and with it the activation, back out
    // of the pane the tab just moved into.
    await vi.waitFor(() => {
      expect(panes[1]!.element().getAttribute('data-active')).toBe('true')
      expect(panes[0]!.element().getAttribute('data-active')).toBeNull()
      expect(panes[1]!.element().contains(document.activeElement)).toBe(true)
    })

    await view.unmount()
  })

  it('drops a pill on its own strip and the strip reorders', async () => {
    settingsStore.seed(TWO_TAB_PANE)
    const view = await renderDragFrame()
    const pills = view
      .getByTestId('workspace-pane')
      .all()[0]!
      .element()
      .querySelectorAll('[role="tab"]')
    expect(pills).toHaveLength(2)

    const drag = startDrag(pills[1]!)
    await dragOver(drag, pills[0]!, 'surface:daily')
    drag.end()

    await vi.waitFor(() => {
      const panes = (settingsStore.get().openTabs[GRAPH_ROOT] ?? []).flatMap(
        (column) => column.panes,
      )
      expect(panes).toHaveLength(1)
      expect(
        panes[0]!.tabs.map((tab) => (tab.kind === 'surface' ? tab.surface : tab.kind)),
      ).toEqual(['tasks', 'daily'])
    })

    await view.unmount()
  })
})
