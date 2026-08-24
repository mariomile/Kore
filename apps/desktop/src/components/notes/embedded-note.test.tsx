import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { EmbeddedNote } from './embedded-note'

const mocks = vi.hoisted(() => ({
  resolveExistingWikiTarget: vi.fn(),
  readExistingNoteSource: vi.fn(),
}))

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  resolveExistingWikiTarget: mocks.resolveExistingWikiTarget,
}))

vi.mock('@/lib/read-existing-note-source', () => ({
  readExistingNoteSource: mocks.readExistingNoteSource,
}))

vi.mock('@/hooks/use-bridge-ready', () => ({
  useBridgeReady: () => true,
}))

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))

vi.mock('@/hooks/use-note-link-navigation', () => ({
  useNoteLinkNavigation: () => vi.fn(),
}))

vi.mock('@/editor/use-wiki-link-navigation', () => ({
  useWikiLinkNavigation: () => vi.fn(),
}))

vi.mock('@/editor/markdown-preview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}))

function renderEmbed(
  embed: { target: string; heading: string | null },
  sourcePath = 'notes/today.md',
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EmbeddedNote embed={embed} sourcePath={sourcePath} resolveImageUrl={() => null} />
    </QueryClientProvider>,
  )
}

describe('EmbeddedNote', () => {
  beforeEach(() => {
    mocks.resolveExistingWikiTarget.mockReset()
    mocks.readExistingNoteSource.mockReset()
  })

  it('renders the transcluded body of a resolved note', async () => {
    mocks.resolveExistingWikiTarget.mockResolvedValue({
      kind: 'resolved',
      path: 'notes/dune.md',
    })
    mocks.readExistingNoteSource.mockResolvedValue('# Dune\n\nSandworms.\n')

    const view = await renderEmbed({ target: 'Dune', heading: null })
    const root = view.getByTestId('note-embed')
    await expect.element(root).toBeInTheDocument()
    await expect.element(root).toHaveAttribute('data-embed-target', 'Dune')
    await expect.element(view.getByRole('button', { name: 'Open Dune' })).toBeInTheDocument()
    await expect.element(view.getByTestId('markdown-preview')).toHaveTextContent('Sandworms.')
  })

  it('renders a heading section when the embed names one', async () => {
    mocks.resolveExistingWikiTarget.mockResolvedValue({
      kind: 'resolved',
      path: 'notes/dune.md',
    })
    mocks.readExistingNoteSource.mockResolvedValue(
      '# Dune\n\nIntro.\n\n## Plot\n\nSandworms.\n\n## Themes\n\nPower.\n',
    )

    const view = await renderEmbed({ target: 'Dune', heading: 'Plot' })
    await expect
      .element(view.getByTestId('note-embed'))
      .toHaveAttribute('data-embed-heading', 'Plot')
    await expect.element(view.getByTestId('markdown-preview')).toHaveTextContent('Sandworms.')
    await expect.element(view.getByTestId('markdown-preview')).not.toHaveTextContent('Power.')
  })

  it('refuses to embed the current note into itself', async () => {
    mocks.resolveExistingWikiTarget.mockResolvedValue({
      kind: 'resolved',
      path: 'notes/today.md',
    })
    mocks.readExistingNoteSource.mockResolvedValue('# Today\n\nHello.\n')

    const view = await renderEmbed({ target: 'Today', heading: null }, 'notes/today.md')
    await expect.element(view.getByText('This note can’t embed itself.')).toBeInTheDocument()
  })

  it('shows a missing-note message when the target does not resolve', async () => {
    mocks.resolveExistingWikiTarget.mockResolvedValue({ kind: 'missing' })

    const view = await renderEmbed({ target: 'Ghost', heading: null })
    await expect
      .element(view.getByText('[[Ghost]] doesn’t match a note in this graph.'))
      .toBeInTheDocument()
  })
})
