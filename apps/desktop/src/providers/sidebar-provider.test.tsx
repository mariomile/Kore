import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import { useEffect, type ReactElement } from 'react'
import { SidebarProvider, useSidebar } from './sidebar-provider'

function Probe({ railAvailable }: { railAvailable: boolean }): ReactElement {
  const { contextCollapsed, toggleContextSidebar, setContextRailAvailable } = useSidebar()
  useEffect(() => setContextRailAvailable(railAvailable), [railAvailable, setContextRailAvailable])
  return (
    <button type="button" onClick={toggleContextSidebar}>
      {contextCollapsed ? 'collapsed' : 'expanded'}
    </button>
  )
}

describe('SidebarProvider context toggle', () => {
  it('flips the rail where the route shows it', async () => {
    await render(
      <SidebarProvider>
        <Probe railAvailable />
      </SidebarProvider>,
    )
    await page.getByRole('button').click()
    await expect.element(page.getByRole('button')).toHaveTextContent('collapsed')
  })

  it('does nothing on a route without the rail, so the next note keeps its state', async () => {
    await render(
      <SidebarProvider>
        <Probe railAvailable={false} />
      </SidebarProvider>,
    )
    await page.getByRole('button').click()
    await expect.element(page.getByRole('button')).toHaveTextContent('expanded')
  })
})
