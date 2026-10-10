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
}))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  readCanvasFile: mocks.readCanvasFile,
  listCanvasFiles: mocks.listCanvasFiles,
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
})

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
})
