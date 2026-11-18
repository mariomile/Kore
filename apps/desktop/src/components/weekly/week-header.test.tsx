import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { isoWeekFromKey } from '@kore/core'
import { RouterProvider, useRouter } from '@/routing/router'
import '@/test-utils/locator'
import { WeekHeader } from './week-header'

const dailyDatesInRange = vi.hoisted(() => vi.fn())
const today = vi.hoisted(() => vi.fn(() => '2026-11-18'))

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  hasBridge: () => true,
  dailyDatesInRange,
}))
vi.mock('@/lib/use-today', () => ({ useToday: today }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))

function RouteProbe(): ReactNode {
  const { route } = useRouter()
  return <output data-testid="route">{JSON.stringify(route)}</output>
}

function renderHeader(weekKey: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider>
        <WeekHeader week={isoWeekFromKey(weekKey)!} />
        <RouteProbe />
      </RouterProvider>
    </QueryClientProvider>,
  )
}

const routeTo = (path: string): string => JSON.stringify({ kind: 'note', path })

beforeEach(() => {
  dailyDatesInRange.mockReset().mockResolvedValue([])
  today.mockReturnValue('2026-11-18')
})

afterEach(async () => {
  await cleanup()
})

describe('WeekHeader', () => {
  it('names the week and its range', async () => {
    const view = await renderHeader('2026-W47')
    await expect.element(page.getByRole('heading', { name: 'Week 47' })).toBeVisible()
    await expect.element(page.getByText('Nov 16 – 22, 2026')).toBeVisible()
    await view.unmount()
  })

  it('marks the days that have a daily note and opens a day', async () => {
    dailyDatesInRange.mockResolvedValue(['2026-11-17'])
    const view = await renderHeader('2026-W47')
    await expect.element(page.getByTestId('week-note-dot-2026-11-17')).toBeInTheDocument()
    expect(dailyDatesInRange).toHaveBeenCalledWith('2026-11-16', '2026-11-22')
    await expect.element(page.getByTestId('week-note-dot-2026-11-18')).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Wednesday, November 18' }))
      .toHaveAttribute('aria-current', 'date')

    await userEvent.click(page.getByRole('button', { name: 'Thursday, November 19' }))
    await expect
      .element(page.getByTestId('route'))
      .toHaveTextContent(JSON.stringify({ kind: 'daily', date: '2026-11-19' }))
    await view.unmount()
  })

  it('steps to the previous and next week across the year boundary', async () => {
    const view = await renderHeader('2026-W53')
    await userEvent.click(page.getByRole('button', { name: 'Next week' }))
    await expect.element(page.getByTestId('route')).toHaveTextContent(routeTo('weekly/2027-W01.md'))
    await userEvent.click(page.getByRole('button', { name: 'Previous week' }))
    await expect.element(page.getByTestId('route')).toHaveTextContent(routeTo('weekly/2026-W52.md'))
    await view.unmount()
  })

  it('jumps to this week, and rests while this week is open', async () => {
    const view = await renderHeader('2026-W40')
    await userEvent.click(page.getByRole('button', { name: 'This week' }))
    await expect.element(page.getByTestId('route')).toHaveTextContent(routeTo('weekly/2026-W47.md'))
    await view.unmount()

    const current = await renderHeader('2026-W47')
    await expect.element(page.getByRole('button', { name: 'This week' })).toBeDisabled()
    await current.unmount()
  })
})
