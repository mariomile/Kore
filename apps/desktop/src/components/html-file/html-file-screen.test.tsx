import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

const PAGE = '<!doctype html><title>Q4 retention</title><h1>Report</h1>'

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  htmlPageUrl: () => `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))
vi.mock('@/editor/use-asset-persistence', () => ({
  useAssetPersistence: () => ({ openAsset: vi.fn() }),
}))

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/lib/platform-surface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform-surface')>()),
  isMobileSurface: () => mobile.value,
}))
const back = vi.fn()
vi.mock('@/routing/router', () => ({
  useRouter: () => ({ navigate: vi.fn(), back, canBack: true }),
}))

const { HtmlFileScreen } = await import('./html-file-screen')

describe('HtmlFileScreen', () => {
  it('names the page by its title and runs it sandboxed, apart from the app', async () => {
    const view = await render(
      <QueryClientProvider client={new QueryClient()}>
        <HtmlFileScreen path="Reports/retention-q4.html" />
      </QueryClientProvider>,
    )
    await expect.element(view.getByRole('heading', { name: 'Q4 retention' })).toBeVisible()
    const frame = view.getByTitle('Q4 retention').element()
    // Scripts run; same-origin never: the page gets an opaque origin.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    await view.unmount()
  })

  it('is a pushed screen on iPhone: back, title, share, the page full width', async () => {
    mobile.value = true
    const view = await render(
      <QueryClientProvider client={new QueryClient()}>
        <HtmlFileScreen path="Reports/retention-q4.html" />
      </QueryClientProvider>,
    )
    await expect.element(view.getByRole('heading', { name: 'Q4 retention' })).toBeVisible()
    await expect.element(view.getByRole('button', { name: 'Share' })).toBeVisible()
    await view.getByRole('button', { name: 'Back' }).click()
    expect(back).toHaveBeenCalledOnce()
    mobile.value = false
    await view.unmount()
  })
})
