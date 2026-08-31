import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import { useEffect, type ReactElement, type ReactNode } from 'react'
import { FocusedDailyProvider, useSetFocusedDailyDate } from '@/providers/focused-daily-provider'
import { RouterProvider, useRouter } from '@/routing/router'
import { addDaysIso, formatDayPillLabel, todayIso } from '@/lib/dates'
import type { Route } from '@/routing/route'
import { DailyDatePill } from './daily-date-pill'

vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { dateFormat: 'mdy', timeFormat: '12h' },
  }),
}))

/** Records every route the pill navigates to. */
function RouteProbe({ log }: { log: Route[] }): null {
  const { route } = useRouter()
  useEffect(() => {
    log.push(route)
  }, [route, log])
  return null
}

function FocusProbe({ date }: { date: string }): null {
  const setFocused = useSetFocusedDailyDate()
  useEffect(() => {
    setFocused(date)
  }, [setFocused, date])
  return null
}

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <RouterProvider initialRoute={{ kind: 'today' }}>
      <FocusedDailyProvider>{children}</FocusedDailyProvider>
    </RouterProvider>
  )
}

describe('DailyDatePill', () => {
  it('names today on the today route and hops to the adjacent days', async () => {
    const today = todayIso()
    const log: Route[] = []
    const view = await render(
      <Providers>
        <RouteProbe log={log} />
        <DailyDatePill />
      </Providers>,
    )

    await expect.element(view.getByText(formatDayPillLabel(today, 'mdy'))).toBeInTheDocument()

    await view.getByRole('button', { name: 'Next day' }).click()
    expect(log.at(-1)).toEqual({ kind: 'daily', date: addDaysIso(today, 1) })

    // The pill now names the routed day and keeps hopping from it.
    await expect
      .element(view.getByText(formatDayPillLabel(addDaysIso(today, 1), 'mdy')))
      .toBeInTheDocument()
    await view.getByRole('button', { name: 'Previous day' }).click()
    expect(log.at(-1)).toEqual({ kind: 'daily', date: today })
  })

  it('follows the focused day and its label jumps back to today', async () => {
    const today = todayIso()
    const focused = addDaysIso(today, -3)
    const log: Route[] = []
    const view = await render(
      <Providers>
        <RouteProbe log={log} />
        <FocusProbe date={focused} />
        <DailyDatePill />
      </Providers>,
    )

    // The focused day wins over the routed one — the pill names what is read.
    await expect.element(view.getByText(formatDayPillLabel(focused, 'mdy'))).toBeInTheDocument()
    await view.getByRole('button', { name: 'Previous day' }).click()
    expect(log.at(-1)).toEqual({ kind: 'daily', date: addDaysIso(focused, -1) })

    await view.getByTitle('Jump to today').click()
    expect(log.at(-1)).toEqual({ kind: 'today' })
  })
})
