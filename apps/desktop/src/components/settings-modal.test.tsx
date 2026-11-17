import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { createRouterStore } from '@/routing/router-store'
import { RouterProvider, useRouter } from '@/routing/router'

// The screen's own groups are `settings-screen.test.tsx`'s subject.
vi.mock('@/components/settings-screen', () => ({
  SettingsScreen: () => <p>Settings screen</p>,
}))

const { BeneathSettings, SettingsModal } = await import('./settings-modal')

/** What the workspace beneath the modal believes the route is. */
function RouteProbe(): ReactElement {
  const { route } = useRouter()
  return <output aria-label="Beneath">{route.kind}</output>
}

function Harness({ store }: { store: ReturnType<typeof createRouterStore> }): ReactElement {
  return (
    <RouterProvider store={store}>
      <BeneathSettings>
        <RouteProbe />
      </BeneathSettings>
      <SettingsModal />
    </RouterProvider>
  )
}

describe('SettingsModal', () => {
  it('opens over the route it came from and keeps that route beneath it', async () => {
    const store = createRouterStore({ kind: 'tasks' })
    await render(<Harness store={store} />)
    expect(page.getByRole('dialog').query()).toBeNull()

    store.navigate({ kind: 'settings' })
    await expect.element(page.getByText('Settings screen')).toBeInTheDocument()
    await expect.element(page.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    await expect.element(page.getByLabelText('Beneath')).toHaveTextContent('tasks')

    store.navigate({ kind: 'settings', group: 'integrations' })
    await expect.element(page.getByLabelText('Beneath')).toHaveTextContent('tasks')
  })

  it('returns to where it was opened from on Escape', async () => {
    const store = createRouterStore({ kind: 'tasks' })
    await render(<Harness store={store} />)
    store.navigate({ kind: 'settings' })
    store.navigate({ kind: 'settings', group: 'notes' })
    await expect.element(page.getByText('Settings screen')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    await expect.poll(() => store.getSnapshot().route.kind).toBe('tasks')
    await expect.poll(() => page.getByRole('dialog').query()).toBeNull()
  })

  it('shows today beneath a window that launched straight into Settings', async () => {
    const store = createRouterStore({ kind: 'settings' })
    await render(<Harness store={store} />)

    await expect.element(page.getByLabelText('Beneath')).toHaveTextContent('today')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => store.getSnapshot().route.kind).toBe('today')
  })
})
