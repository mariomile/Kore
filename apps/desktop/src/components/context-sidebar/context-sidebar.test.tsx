import { render } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'

/**
 * The right rail's panel switcher: the band starts as Details alone plus the
 * "+", Details follows the target (or shows the empty state), the panels the
 * "+" opens become tabs you can close again, and every panel renders inside
 * the rail's own card. The panels themselves are mocked — each has its own
 * test.
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

/** Open a panel the way a user does: the "+" menu, then its entry. */
async function openPanel(view: Awaited<ReturnType<typeof render>>, label: string): Promise<void> {
  await view.getByRole('button', { name: 'Open a panel' }).click()
  await view.getByRole('menuitem', { name: label }).click()
}

describe('ContextSidebar', () => {
  it('starts with Details alone and adds panels through the "+"', async () => {
    const view = await render(<ContextSidebar target={{ kind: 'daily', date: '2026-08-17' }} />)
    expect(view.getByTestId('daily-details').element().textContent).toBe('2026-08-17')

    // Details is the whole band until the "+" adds to it.
    await expect.element(view.getByRole('tab', { name: 'Details' })).toBeVisible()
    for (const label of ['Chat', 'Calendar', 'Browser', 'Terminal']) {
      expect(view.getByRole('tab', { name: label }).query()).toBeNull()
    }

    await openPanel(view, 'Chat')
    await expect.element(view.getByTestId('chat-panel')).toBeInTheDocument()
    // The rail is auxiliary: opening it must not pull the caret out of the note.
    await expect.element(view.getByTestId('chat-panel')).toHaveAttribute('data-autofocus', 'false')
    expect(view.getByTestId('daily-details').query()).toBeNull()
    // An opened panel keeps its segment, so the band can switch back to it.
    await expect.element(view.getByRole('tab', { name: 'Chat' })).toBeVisible()

    await openPanel(view, 'Calendar')
    // The calendar panel anchors on the daily target's date.
    await expect.element(view.getByTestId('month-calendar')).toBeInTheDocument()
    expect(view.getByTestId('month-calendar').element().textContent).toBe('2026-08-17')

    await view.getByRole('tab', { name: 'Chat' }).click()
    await expect.element(view.getByTestId('chat-panel')).toBeInTheDocument()

    await view.getByRole('tab', { name: 'Details' }).click()
    await expect.element(view.getByTestId('daily-details')).toBeInTheDocument()
    await view.unmount()
  })

  it('closes a tab from the band and falls back to Details', async () => {
    const view = await render(<ContextSidebar target={{ kind: 'daily', date: '2026-08-17' }} />)

    await openPanel(view, 'Chat')
    await expect.element(view.getByTestId('chat-panel')).toBeInTheDocument()

    // Closing the tab on screen takes it off the band.
    await view.getByRole('button', { name: 'Close Chat' }).click()
    expect(view.getByRole('tab', { name: 'Chat' }).query()).toBeNull()
    await expect.element(view.getByTestId('daily-details')).toBeInTheDocument()
    await view.unmount()
  })

  it('closes a tab that is not the one on screen, and never Details', async () => {
    const view = await render(<ContextSidebar target={{ kind: 'daily', date: '2026-08-17' }} />)

    await openPanel(view, 'Chat')
    await openPanel(view, 'Calendar')
    // Details is the one tab the rail always carries, so it has no close.
    expect(view.getByRole('button', { name: 'Close Details' }).query()).toBeNull()

    // Closing a background tab leaves the panel on screen alone.
    await view.getByRole('button', { name: 'Close Chat' }).click()
    expect(view.getByRole('tab', { name: 'Chat' }).query()).toBeNull()
    await expect.element(view.getByTestId('month-calendar')).toBeInTheDocument()

    // And it can be opened again from the "+".
    await openPanel(view, 'Chat')
    await expect.element(view.getByRole('tab', { name: 'Chat' })).toBeVisible()
    await view.unmount()
  })

  it('re-picking an open panel from the "+" shows it instead of duplicating its tab', async () => {
    const view = await render(<ContextSidebar target={null} />)

    await openPanel(view, 'Chat')
    await openPanel(view, 'Calendar')
    await openPanel(view, 'Chat')

    await expect.element(view.getByTestId('chat-panel')).toBeInTheDocument()
    expect(view.getByRole('tab', { name: 'Chat' }).elements()).toHaveLength(1)
    await view.unmount()
  })

  it('hosts the built-in browser and the terminal as panels', async () => {
    const view = await render(<ContextSidebar target={null} />)

    await openPanel(view, 'Browser')
    await expect.element(view.getByTestId('browser-panel')).toBeInTheDocument()

    await openPanel(view, 'Terminal')
    await expect.element(view.getByTestId('terminal-panel')).toBeInTheDocument()
    expect(view.getByTestId('browser-panel').query()).toBeNull()
    await view.unmount()
  })

  it('leaves tags to the left rail', async () => {
    const view = await render(<ContextSidebar target={null} />)
    await view.getByRole('button', { name: 'Open a panel' }).click()
    expect(view.getByRole('menuitem', { name: 'Tags' }).query()).toBeNull()
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
    await openPanel(view, 'Calendar')
    expect(view.getByTestId('month-calendar').element().textContent).toBe('2026-08-19')
    await view.unmount()
  })
})
