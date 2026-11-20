import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ContextPanel } from './context-panel'
import { ContextCollapsedRail } from './context-collapsed-rail'

const openContextPanel = vi.hoisted(() => vi.fn<(panel: ContextPanel) => void>())
const toggleContextSidebar = vi.hoisted(() => vi.fn())
const panelState = vi.hoisted(() => ({
  opened: [] as ContextPanel[],
  active: 'details' as ContextPanel,
}))

vi.mock('@/providers/sidebar-provider', () => ({
  useSidebar: () => ({
    contextPanels: { opened: panelState.opened, active: panelState.active },
    openContextPanel,
    toggleContextSidebar,
  }),
}))

beforeEach(() => {
  openContextPanel.mockClear()
  toggleContextSidebar.mockClear()
  panelState.opened = []
  panelState.active = 'details'
})

describe('ContextCollapsedRail', () => {
  it('shows only opened tabs and expands to the clicked panel', async () => {
    panelState.opened = ['chat', 'terminal']
    panelState.active = 'chat'

    const view = await render(
      <div className="h-[560px] w-11">
        <TooltipProvider>
          <ContextCollapsedRail showDetails routeKind="today" />
        </TooltipProvider>
      </div>,
    )

    await expect.element(view.getByRole('button', { name: 'Toggle context panel' })).toBeVisible()
    await expect.element(view.getByRole('button', { name: 'Open Details' })).toBeVisible()
    await expect.element(view.getByRole('button', { name: 'Open Chat' })).toBeVisible()
    await expect.element(view.getByRole('button', { name: 'Open Terminal' })).toBeVisible()
    expect(view.getByRole('button', { name: 'Open Calendar' }).query()).toBeNull()
    expect(view.getByRole('button', { name: 'Open Browser' }).query()).toBeNull()

    await view.getByRole('button', { name: 'Toggle context panel' }).click()
    expect(toggleContextSidebar).toHaveBeenCalledTimes(1)

    await view.getByRole('button', { name: 'Open Terminal' }).click()
    expect(openContextPanel).toHaveBeenCalledWith('terminal')
    expect(toggleContextSidebar).toHaveBeenCalledTimes(2)
  })

  it('opens an unadded panel from the + menu and expands the rail onto it', async () => {
    const view = await render(
      <div className="h-[560px] w-11">
        <TooltipProvider>
          <ContextCollapsedRail showDetails routeKind="chat" />
        </TooltipProvider>
      </div>,
    )

    await view.getByRole('button', { name: 'Open a panel' }).click()
    expect(page.getByRole('menuitem', { name: 'Chat' }).query()).toBeNull()
    await page.getByRole('menuitem', { name: 'Calendar' }).click()

    expect(openContextPanel).toHaveBeenCalledWith('calendar')
    expect(toggleContextSidebar).toHaveBeenCalledTimes(1)
  })
})
