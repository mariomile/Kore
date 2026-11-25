import { cleanup, render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@/test-utils/locator'
import { WeekRow } from './week-row'

const haptic = vi.hoisted(() => vi.fn())

vi.mock('@/lib/haptics', () => ({ haptic }))

afterEach(async () => {
  await cleanup()
  haptic.mockReset()
})

describe('WeekRow', () => {
  it('keeps a daily note marked when the date is both selected and today', async () => {
    const onSelect = vi.fn()
    await render(
      <WeekRow
        weekStart="2026-07-13"
        selectedDay="2026-07-16"
        todayDay="2026-07-16"
        dailyNoteDates={new Set(['2026-07-13', '2026-07-16'])}
        onSelect={onSelect}
      />,
    )

    const selected = page.getByRole('button', {
      name: 'Thursday, July 16th, has daily note',
    })
    await expect.element(selected).toHaveAttribute('aria-current', 'date')
    await expect.element(page.getByTestId('note-dot-2026-07-16')).toBeVisible()
    await expect.element(page.getByTestId('note-dot-2026-07-13')).toBeVisible()
    await expect.element(page.getByTestId('note-dot-2026-07-14')).not.toBeInTheDocument()

    await userEvent.click(selected)
    expect(haptic).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith('2026-07-16')
  })

  it('shows the selection circle in place on mount, and zooms it in only on arrival', async () => {
    const props = {
      weekStart: '2026-07-13',
      todayDay: '2026-07-16',
      dailyNoteDates: new Set<string>(),
      onSelect: vi.fn(),
    }
    const view = await render(<WeekRow {...props} selectedDay="2026-07-16" />)

    // Launch and every return to Daily: the circle is already there, so today
    // never shows as a bare white number while a zoom plays.
    const mounted = page.getByTestId('week-selection-circle').element()
    expect(mounted.classList.contains('animate-in')).toBe(false)

    // The selection leaves the week (paging away), then comes back: that
    // arrival is a real transition and zooms in.
    await view.rerender(<WeekRow {...props} selectedDay={null} />)
    await expect.element(page.getByTestId('week-selection-circle')).not.toBeInTheDocument()
    await view.rerender(<WeekRow {...props} selectedDay="2026-07-14" />)
    const arrived = page.getByTestId('week-selection-circle').element()
    expect(arrived.classList.contains('animate-in')).toBe(true)
  })
})
