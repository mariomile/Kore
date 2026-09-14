import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Fragment, useSyncExternalStore, type ReactElement } from 'react'
import { setBridge, type OpenPane } from '@reflect/core'
import type { CommandContext } from '@/lib/commands/types'
import { PanesProvider, usePanes } from '@/providers/panes-provider'
import { SidebarProvider } from '@/providers/sidebar-provider'
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
    openTabs: Record<string, OpenPane[]>
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
    seed(panes: OpenPane[]): void {
      doc = { openTabs: { [GRAPH_ROOT]: panes } }
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

function PaneRow(): ReactElement {
  const { panes } = usePanes()
  return (
    <div className="flex">
      {panes.map((pane, index) => (
        <Fragment key={pane.id}>
          {index > 0 ? <PaneResizeHandle /> : null}
          <WorkspacePane pane={pane} commandContext={COMMAND_CONTEXT} />
        </Fragment>
      ))}
    </div>
  )
}

function firePointer(element: Element, type: string, init: PointerEventInit): void {
  element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }))
}

function renderPanes() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <PanesProvider>
          <PaneRow />
        </PanesProvider>
      </SidebarProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  settingsStore.seed([])
})

const SPLIT_PANES: OpenPane[] = [
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
    const left = view.getByTestId('workspace-pane').all()[0]!.element()

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
})
