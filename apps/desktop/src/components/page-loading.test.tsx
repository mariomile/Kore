import { render } from 'vitest-browser-react'
import { describe, expect, it } from 'vitest'
import { PageLoading } from './page-loading'

describe('PageLoading', () => {
  it('renders the centered, delayed Kore gem mark with a status role', async () => {
    const view = await render(
      <div className="flex h-64 w-64">
        <PageLoading label="Loading graph" className="h-full" />
      </div>,
    )

    const status = view.getByRole('status', { name: 'Loading graph' })
    await expect.element(status).toBeInTheDocument()
    expect(status.element().className).toContain('kore-note-loading')
    expect(status.element().querySelector('img')?.getAttribute('src')).toContain('kore-mark')
  })
})
