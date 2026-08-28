import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'

/**
 * The right rail's panel switcher: Details follows the target (or shows the
 * empty state), Chat and Calendar swap in their surfaces, and every panel
 * renders inside the rail's own card. The panels themselves are mocked —
 * each has its own test.
 */

vi.mock('@/components/chat/chat-screen', () => ({
  ChatScreen: ({ autoFocus }: { autoFocus?: boolean }) => (
    <div data-testid="chat-panel" data-autofocus={String(autoFocus)} />
  ),
}))
vi.mock('@/components/browser/browser-pane', () => ({
  BrowserPane: () => <div data-testid="browser-panel" />,
}))
vi.mock('@/components/terminal/terminal-screen', () => ({
  TerminalScreen: () => <div data-testid="terminal-panel" />,
}))
vi.mock('@/components/context-sidebar/daily-context-sidebar', () => ({
  DailyContextSidebar: ({ date }: { date: string }) => (
    <div data-testid="daily-details">{date}</div>
  ),
}))
vi.mock('@/components/context-sidebar/note-context-sidebar', () => ({
  NoteContextSidebar: ({ path }: { path: string }) => <div data-testid="note-details">{path}</div>,
}))
vi.mock('@/components/context-sidebar/day-calendar', () => ({
  DayCalendar: ({ selectedDate }: { selectedDate: string }) => (
    <div data-testid="month-calendar">{selectedDate}</div>
  ),
}))
vi.mock('@/components/context-sidebar/daily-events-section', () => ({
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
    // The rail is auxiliary: opening it must not pull the caret out of the note.
    await expect.element(view.getByTestId('chat-panel')).toHaveAttribute('data-autofocus', 'false')
    expect(view.getByTestId('daily-details').query()).toBeNull()

    await view.getByRole('tab', { name: 'Calendar' }).click()
    // The calendar panel anchors on the daily target's date.
    await expect.element(view.getByTestId('month-calendar')).toBeInTheDocument()
    expect(view.getByTestId('month-calendar').element().textContent).toBe('2026-08-17')

    await view.getByRole('tab', { name: 'Details' }).click()
    await expect.element(view.getByTestId('daily-details')).toBeInTheDocument()
    await view.unmount()
  })

  it('hosts the built-in browser and the terminal as panels', async () => {
    const view = await render(<ContextSidebar target={null} />)

    await view.getByRole('tab', { name: 'Browser' }).click()
    await expect.element(view.getByTestId('browser-panel')).toBeInTheDocument()

    await view.getByRole('tab', { name: 'Terminal' }).click()
    await expect.element(view.getByTestId('terminal-panel')).toBeInTheDocument()
    expect(view.getByTestId('browser-panel').query()).toBeNull()
    await view.unmount()
  })

  it('leaves tags to the left rail', async () => {
    const view = await render(<ContextSidebar target={null} />)
    expect(view.getByRole('tab', { name: 'Tags' }).query()).toBeNull()
    await view.unmount()
  })

  it('renders its panels inside the rail card', async () => {
    const view = await render(<ContextSidebar target={null} />)
    const gutter = view.getByTestId('context-pane-gutter').element()
    expect(gutter.querySelector('.app-glass-card')).not.toBeNull()
    // The switcher stays outside the card, on the window's drag band.
    expect(gutter.querySelector('[role="tablist"]')).toBeNull()
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
