import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider } from '@/routing/router'
import { UnlinkedMentionsPanel } from './unlinked-mentions-panel'

const getUnlinkedMentions = vi.hoisted(() => vi.fn())
const linkUnlinkedMention = vi.hoisted(() => vi.fn())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  getUnlinkedMentions,
  linkUnlinkedMention,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))

const mention = {
  sourcePath: 'notes/weekly.md',
  sourceTitle: 'Weekly',
  targetTitle: 'Project Atlas',
  snippet: 'Discussed Project Atlas at length.',
  matchStart: 10,
  matchEnd: 23,
  posFrom: 10,
}

function renderPanel(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider>
        <UnlinkedMentionsPanel path={path} />
      </RouterProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getUnlinkedMentions.mockReset()
  linkUnlinkedMention.mockReset()
})

describe('UnlinkedMentionsPanel', () => {
  it('renders nothing when there are no mentions', async () => {
    getUnlinkedMentions.mockResolvedValue([])
    const view = await renderPanel('notes/project-atlas.md')
    await vi.waitFor(() => expect(getUnlinkedMentions).toHaveBeenCalled())
    expect(view.getByText(/Unlinked mention/).query()).toBeNull()
    await view.unmount()
  })

  it('lists mentions with the match emphasized', async () => {
    getUnlinkedMentions.mockResolvedValue([mention])
    const view = await renderPanel('notes/project-atlas.md')
    await expect.element(view.getByText('Unlinked mention (1)')).toBeVisible()
    await expect.element(view.getByRole('button', { name: 'Weekly' })).toBeVisible()
    await expect.element(view.getByText('Project Atlas', { exact: true })).toBeVisible()
    await view.unmount()
  })

  it('converts a mention through the Link action', async () => {
    getUnlinkedMentions.mockResolvedValue([mention])
    linkUnlinkedMention.mockResolvedValue('linked')
    const view = await renderPanel('notes/project-atlas.md')
    await view.getByRole('button', { name: /^Link$/ }).click()
    await vi.waitFor(() =>
      expect(linkUnlinkedMention).toHaveBeenCalledWith({
        sourcePath: 'notes/weekly.md',
        targetTitle: 'Project Atlas',
        generation: 1,
      }),
    )
    await view.unmount()
  })

  it('surfaces a failed conversion inline', async () => {
    getUnlinkedMentions.mockResolvedValue([mention])
    linkUnlinkedMention.mockRejectedValue(new Error('write failed'))
    const view = await renderPanel('notes/project-atlas.md')
    await view.getByRole('button', { name: /^Link$/ }).click()
    await expect
      .element(view.getByRole('alert'))
      .toHaveTextContent('Couldn’t link this mention — try again.')
    await view.unmount()
  })
})
