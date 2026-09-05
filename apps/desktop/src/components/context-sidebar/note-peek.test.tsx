import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { DEFAULT_SETTINGS, setBridge } from '@reflect/core'
import { NotePeek } from './note-peek'

/**
 * The side peek over a fake bridge: the index answers the note row, the
 * file read answers the body. Navigation and the properties section are
 * stubbed; the peek's own job is title + body + Open.
 */
const navigate = vi.fn()
vi.mock('@/routing/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/routing/router')>()),
  useRouter: () => ({ navigate }),
}))
vi.mock('@/editor/use-wiki-link-navigation', () => ({
  useWikiLinkNavigation: () => vi.fn(),
}))
vi.mock('@/editor/use-asset-persistence', () => ({
  useAssetPersistence: () => ({ resolveImageUrl: () => null, resolveAssetOpenPath: () => null }),
}))
vi.mock('@/components/context-sidebar/note-properties-section', () => ({
  NotePropertiesSection: () => <div data-testid="peek-properties" />,
}))
vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({ settings: DEFAULT_SETTINGS, updateSettings: vi.fn() }),
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 1 } }),
}))

const SOURCE = '# Solaris\n\nA planet that thinks. See [[Lem]].\n'

setBridge({
  invoke: async (command, args) => {
    if (command === 'db_query') {
      const sql = String((args as Record<string, unknown>)['sql'])
      return sql.includes('from "notes"')
        ? [{ path: 'notes/solaris.md', title: 'Solaris', mtime: 5, kind: 'note' }]
        : []
    }
    if (command === 'note_read') {
      return SOURCE
    }
    return null
  },
  listen: async () => () => {},
})

describe('NotePeek', () => {
  it('renders the row’s title and body, and Open navigates to the note', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = await render(
      <QueryClientProvider client={client}>
        <NotePeek path="notes/solaris.md" />
      </QueryClientProvider>,
    )
    await expect.element(view.getByRole('heading', { name: 'Solaris' })).toBeInTheDocument()
    await expect
      .element(view.getByText('A planet that thinks.', { exact: false }))
      .toBeInTheDocument()
    await expect.element(view.getByTestId('peek-properties')).toBeInTheDocument()

    await view.getByRole('button', { name: 'Open' }).click()
    expect(navigate).toHaveBeenCalledWith({ kind: 'note', path: 'notes/solaris.md' })
    await view.unmount()
  })
})
