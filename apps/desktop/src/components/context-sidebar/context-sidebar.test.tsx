import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'

/**
 * The right rail's panel switcher: Details follows the target (or shows the
 * empty state), Chat and Calendar swap in their surfaces. The panels
 * themselves are mocked — each has its own test.
 */

vi.mock('@/components/chat/chat-screen', () => ({
  ChatScreen: () => <div data-testid="chat-panel" />,
}))
vi.mock('./daily-context-sidebar', () => ({
  DailyContextSidebar: ({ date }: { date: string }) => (
    <div data-testid="daily-details">{date}</div>
  ),
}))
vi.mock('./note-context-sidebar', () => ({
  NoteContextSidebar: ({ path }: { path: string }) => <div data-testid="note-details">{path}</div>,
}))
vi.mock('./day-calendar', () => ({
  DayCalendar: ({ selectedDate }: { selectedDate: string }) => (
    <div data-testid="month-calendar">{selectedDate}</div>
  ),
}))
vi.mock('./daily-events-section', () => ({
  DailyEventsSection: () => null,
}))
vi.mock('@/lib/use-today', () => ({
  useToday: () => '2026-08-19',
}))

const { ContextSidebar } = await import('./context-sidebar')

describe('ContextSidebar', () => {
  it('shows the target details and switches to chat and calendar', async () => {
    const view = await render(<ContextSidebar target={{ kind: 'daily', date: '2026-08-17' }} />)
    expect(view.getByTestId('daily-details').element().textContent).toBe('2026-08-17')

    await view.getByRole('tab', { name: 'Chat' }).click()
    await expect.element(view.getByTestId('chat-panel')).toBeInTheDocument()
    expect(view.getByTestId('daily-details').query()).toBeNull()

    await view.getByRole('tab', { name: 'Calendar' }).click()
    // The calendar panel anchors on the daily target's date.
    await expect.element(view.getByTestId('month-calendar')).toBeInTheDocument()
    expect(view.getByTestId('month-calendar').element().textContent).toBe('2026-08-17')

    await view.getByRole('tab', { name: 'Details' }).click()
    await expect.element(view.getByTestId('daily-details')).toBeInTheDocument()
    await view.unmount()
  })

  it('panel switcher icons sit in liquid-glass tiles', async () => {
    const view = await render(<ContextSidebar target={null} />)
    const details = view.getByRole('tab', { name: 'Details' })
    expect(details.element().querySelector('.sidebar-icon-slot')).not.toBeNull()
    await expect.element(details).toHaveAttribute('aria-selected', 'true')
    await view.unmount()
  })

  it('describes a note target and falls back to the empty state', async () => {
    const view = await render(<ContextSidebar target={{ kind: 'note', path: 'notes/plan.md' }} />)
    expect(view.getByTestId('note-details').element().textContent).toBe('notes/plan.md')

    await view.rerender(<ContextSidebar target={null} />)
    await expect.element(view.getByText('Open a note to see its details here.')).toBeVisible()

    // Without a daily target the calendar anchors on today.
    await view.getByRole('tab', { name: 'Calendar' }).click()
    expect(view.getByTestId('month-calendar').element().textContent).toBe('2026-08-19')
    await view.unmount()
  })
})
