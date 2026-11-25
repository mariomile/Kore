import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Route } from '@/routing/route'
import { RouterProvider, useRouter } from '@/routing/router'

const mocks = vi.hoisted(() => ({
  readCanvasFile: vi.fn<(path: string) => Promise<string>>(),
  listCanvasFiles: vi.fn<() => Promise<string[]>>(),
  readExistingNoteSource: vi.fn<(path: string) => Promise<string>>(),
  navigateNoteLink: vi.fn(),
  writeCanvasFile: vi.fn<(path: string, source: string) => Promise<void>>(),
  mobile: false,
}))
vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  readCanvasFile: mocks.readCanvasFile,
  listCanvasFiles: mocks.listCanvasFiles,
  writeCanvasFile: mocks.writeCanvasFile,
  suggestWikiTargets: () =>
    Promise.resolve([
      { target: 'Brief', path: 'Projects/Brief.md', title: 'Brief', alias: null, date: null },
    ]),
}))
vi.mock('@/lib/platform-surface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform-surface')>()),
  isMobileSurface: () => mocks.mobile,
}))
vi.mock('@/lib/read-existing-note-source', () => ({
  readExistingNoteSource: mocks.readExistingNoteSource,
}))
vi.mock('@/hooks/use-bridge-ready', () => ({ useBridgeReady: () => true }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))
vi.mock('@/hooks/use-note-link-navigation', () => ({
  useNoteLinkNavigation: () => mocks.navigateNoteLink,
}))
vi.mock('@/editor/use-wiki-link-navigation', () => ({ useWikiLinkNavigation: () => vi.fn() }))
vi.mock('@/editor/open-external-link', () => ({ useOpenExternalLink: () => vi.fn() }))
vi.mock('@/editor/use-asset-persistence', () => ({
  useAssetPersistence: () => ({ resolveImageUrl: () => null, openAsset: vi.fn() }),
}))
vi.mock('@/editor/markdown-preview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}))

const { CanvasScreen } = await import('./canvas-screen')

const CANVAS = JSON.stringify({
  nodes: [
    {
      id: 'g',
      type: 'group',
      x: -40,
      y: -40,
      width: 900,
      height: 400,
      label: 'Captoo',
      color: '4',
    },
    { id: 't', type: 'text', x: 0, y: 0, width: 240, height: 120, text: 'Claim shaping' },
    { id: 'n', type: 'file', x: 400, y: 0, width: 300, height: 200, file: 'Projects/Kore.md' },
    {
      id: 'c',
      type: 'file',
      x: 0,
      y: 200,
      width: 240,
      height: 80,
      file: '_system/Vault Map.canvas',
    },
  ],
  edges: [{ id: 'e', fromNode: 't', toNode: 'n', label: 'drives' }],
})

function RouteProbe(): ReactNode {
  const { route } = useRouter()
  return <output data-testid="route">{JSON.stringify(route)}</output>
}

function Screen(): ReactNode {
  const { route } = useRouter()
  return route.kind === 'canvas' ? <CanvasScreen path={route.path} /> : null
}

beforeEach(() => {
  mocks.readCanvasFile.mockReset().mockResolvedValue(CANVAS)
  mocks.listCanvasFiles.mockReset().mockResolvedValue(['Captoo/Captoo.io Canvas.canvas'])
  mocks.readExistingNoteSource.mockReset().mockResolvedValue('# Kore\n\nNote body')
  mocks.navigateNoteLink.mockReset()
  // A write lands on disk: the next read sees it, as the real file would.
  mocks.writeCanvasFile.mockReset().mockImplementation((_path, source) => {
    mocks.readCanvasFile.mockResolvedValue(source)
    return Promise.resolve()
  })
  mocks.mobile = false
})

function pointer(element: Element, type: string, clientX: number, clientY: number): void {
  element.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX, clientY }),
  )
}

async function textCard(view: Awaited<ReturnType<typeof renderScreen>>): Promise<Element> {
  await expect.element(view.getByText('Claim shaping')).toBeInTheDocument()
  return view.getByText('Claim shaping').element().closest('[data-canvas-card]')!
}

/** The JSON the last write put in the file. */
function written(): {
  nodes: { id: string; x: number; y: number; width: number; text?: string }[]
  edges: unknown[]
} {
  const source = mocks.writeCanvasFile.mock.lastCall?.[1]
  expect(source).toBeDefined()
  return JSON.parse(source!) as ReturnType<typeof written>
}

async function renderScreen(initialRoute: Route) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return await render(
    <div style={{ width: 1000, height: 700, display: 'flex', flexDirection: 'column' }}>
      <QueryClientProvider client={client}>
        <RouterProvider initialRoute={initialRoute}>
          <Screen />
          <RouteProbe />
        </RouterProvider>
      </QueryClientProvider>
    </div>,
  )
}

describe('CanvasScreen', () => {
  it('draws groups, text and note cards, and labelled edges', async () => {
    const view = await renderScreen({ kind: 'canvas', path: 'Captoo/Captoo.io Canvas.canvas' })
    await expect.element(view.getByText('Captoo', { exact: true })).toBeInTheDocument()
    await expect.element(view.getByText('Claim shaping')).toBeInTheDocument()
    await expect.element(view.getByText('Note body')).toBeInTheDocument()
    await expect.element(view.getByText('drives')).toBeInTheDocument()
    expect(view.container.querySelectorAll('[data-testid="canvas-edge"]')).toHaveLength(1)
    await view.getByRole('button', { name: 'Open Kore' }).click()
    expect(mocks.navigateNoteLink).toHaveBeenCalledWith({
      target: { kind: 'note', path: 'Projects/Kore.md' },
      openInSplit: false,
    })
  })

  it('opens a linked canvas in Kore', async () => {
    const view = await renderScreen({ kind: 'canvas', path: 'Captoo/Captoo.io Canvas.canvas' })
    await view.getByText('Vault Map').click()
    await expect
      .element(view.getByTestId('route'))
      .toHaveTextContent('{"kind":"canvas","path":"_system/Vault Map.canvas"}')
  })

  it('lists every canvas when no file is open', async () => {
    const index = await renderScreen({ kind: 'canvas', path: null })
    await index.getByText('Captoo.io Canvas', { exact: true }).click()
    await expect
      .element(index.getByTestId('route'))
      .toHaveTextContent('"path":"Captoo/Captoo.io Canvas.canvas"')
  })

  it('reports a file that is not JSON', async () => {
    mocks.readCanvasFile.mockResolvedValue('not json')
    const view = await renderScreen({ kind: 'canvas', path: 'Broken.canvas' })
    await expect.element(view.getByRole('alert')).toHaveTextContent('Couldn’t open this canvas')
  })

  it('moves a card by dragging it, on the grid, and keeps the rest of the file', async () => {
    const view = await renderScreen({ kind: 'canvas', path: 'Captoo/Captoo.io Canvas.canvas' })
    const card = await textCard(view)
    pointer(card, 'pointerdown', 100, 100)
    pointer(card, 'pointermove', 300, 220)
    pointer(card, 'pointerup', 300, 220)
    await vi.waitFor(() => {
      expect(mocks.writeCanvasFile).toHaveBeenCalledTimes(1)
    })
    const text = written().nodes.find((node) => node.id === 't')!
    // The board is fitted below 1:1, so 200 screen px is more than 200 units;
    // whatever the zoom, the card lands on the 20-unit grid, moved right and down.
    expect(text.x % 20).toBe(0)
    expect(text.y % 20).toBe(0)
    expect(text.x).toBeGreaterThan(0)
    expect(written().edges).toHaveLength(1)
    await expect.element(view.getByTestId('canvas-selection')).toBeInTheDocument()
  })

  it('removes the selected card with Backspace and brings it back with ⌘Z', async () => {
    const view = await renderScreen({ kind: 'canvas', path: 'Captoo/Captoo.io Canvas.canvas' })
    const card = await textCard(view)
    pointer(card, 'pointerdown', 100, 100)
    pointer(card, 'pointerup', 100, 100)
    await expect.element(view.getByTestId('canvas-selection')).toBeInTheDocument()
    view
      .getByTestId('canvas-board')
      .element()
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    await vi.waitFor(() => {
      expect(written().nodes.map((node) => node.id)).toEqual(['g', 'n', 'c'])
    })
    // Its edge goes with it.
    expect(written().edges).toEqual([])
    await expect.element(view.getByText('Claim shaping')).not.toBeInTheDocument()
    view
      .getByTestId('canvas-board')
      .element()
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
    await expect.element(view.getByText('Claim shaping')).toBeInTheDocument()
    expect(JSON.parse(mocks.writeCanvasFile.mock.lastCall![1])).toEqual(JSON.parse(CANVAS))
  })

  it('adds a text card, edits its text, and adds a picked note', async () => {
    const view = await renderScreen({ kind: 'canvas', path: 'Captoo/Captoo.io Canvas.canvas' })
    await view.getByRole('button', { name: 'Add text card' }).click()
    const editor = view.getByRole('textbox', { name: 'Card text' })
    await expect.element(editor).toHaveFocus()
    await editor.fill('## Next')
    editor.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => {
      expect(written().nodes.at(-1)).toMatchObject({ type: 'text', text: '## Next', width: 300 })
    })
    await view.getByRole('button', { name: 'Add note' }).click()
    await view.getByRole('option', { name: 'Brief' }).click()
    await vi.waitFor(() => {
      expect(written().nodes.at(-1)).toMatchObject({ type: 'file', file: 'Projects/Brief.md' })
    })
  })

  it('stays a view on the iPhone', async () => {
    mocks.mobile = true
    const view = await renderScreen({ kind: 'canvas', path: 'Captoo/Captoo.io Canvas.canvas' })
    const card = await textCard(view)
    pointer(card, 'pointerdown', 100, 100)
    pointer(card, 'pointermove', 300, 220)
    pointer(card, 'pointerup', 300, 220)
    expect(view.container.querySelector('[data-testid="canvas-selection"]')).toBeNull()
    expect(view.container.querySelector('[aria-label="Add note"]')).toBeNull()
    expect(mocks.writeCanvasFile).not.toHaveBeenCalled()
  })
})
