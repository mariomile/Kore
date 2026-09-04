import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { ReactElement } from 'react'
import { setBridge } from '@reflect/core'
import { RouterProvider } from '@/routing/router'
import { TagPageDescription } from './tag-page-description'

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))

vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: { editorMarkdownSyntax: 'hide', theme: 'system' },
  }),
}))

const mockInvoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()
setBridge({ invoke: mockInvoke, listen: async () => () => {} })

function renderDescription(tag: string): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <RouterProvider initialRoute={{ kind: 'allNotes', tag }}>
        <TagPageDescription tag={tag} />
      </RouterProvider>
    </QueryClientProvider>
  )
}

describe('TagPageDescription', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('renders the definition note body with an Edit link to it', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'note_read' && args['path'] === 'tags/book.md') {
        return '---\nlore: tag\n---\n# Book\n\nA book worth finishing.\n'
      }
      throw { kind: 'notFound', message: 'not found' }
    })

    const view = await render(renderDescription('book'))

    await expect.element(view.getByLabelText('About #book')).toBeInTheDocument()
    await expect.element(view.getByText('A book worth finishing.')).toBeInTheDocument()
    await expect.element(view.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('renders nothing when the definition note is missing', async () => {
    mockInvoke.mockImplementation(async () => {
      throw { kind: 'notFound', message: 'not found' }
    })

    const view = await render(renderDescription('idea'))

    await expect.poll(() => view.getByLabelText('About #idea').query()).toBeNull()
  })
})
