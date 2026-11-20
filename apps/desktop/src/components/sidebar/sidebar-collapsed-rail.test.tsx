import { render } from 'vitest-browser-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type GraphInfo } from '@kore/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { registerAppCommands } from '@/lib/commands/app-commands'
import type { CommandContext } from '@/lib/commands/types'
import { RouterProvider } from '@/routing/router'
import { SidebarCollapsedRail } from './sidebar-collapsed-rail'

const toggleSidebar = vi.hoisted(() => vi.fn())
const openPalette = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())
const navSettings = vi.hoisted(() => ({
  sidebarNav: ['daily', 'newNote', 'allNotes', 'tasks', 'graph'] as const,
  hiddenSidebarItems: [] as string[],
}))

vi.mock('@/components/audio-memo/audio-memo-button', () => ({
  AudioMemoButton: () => <button type="button" aria-label="Record audio memo" />,
}))
vi.mock('@/hooks/use-graph-colors', () => ({
  useGraphColors: () => ({ colorFor: () => 'blue', setColor: vi.fn() }),
}))
vi.mock('@/hooks/use-pinned-notes', () => ({ usePinnedNotes: () => [] }))
vi.mock('@/hooks/use-memory-kit', () => ({ useMemoryKitActive: () => false }))
vi.mock('@/providers/sidebar-provider', () => ({
  useSidebar: () => ({ toggleSidebar }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: {
      ...DEFAULT_SETTINGS,
      sidebarNav: [...navSettings.sidebarNav],
      hiddenSidebarItems: [...navSettings.hiddenSidebarItems],
    },
    updateSettingsWith: vi.fn(),
  }),
}))

const GRAPH: GraphInfo = { root: '/notes', name: 'Notes', generation: 1 }

function makeContext(): CommandContext {
  return {
    navigate,
    openPalette,
    toggleSidebar,
    toggleContextSidebar: vi.fn(),
  } as unknown as CommandContext
}

beforeEach(() => {
  registerAppCommands()
  toggleSidebar.mockClear()
  openPalette.mockClear()
  navigate.mockClear()
  navSettings.hiddenSidebarItems = []
})

describe('SidebarCollapsedRail', () => {
  it('renders visible nav icons, respects hidden items, and runs commands', async () => {
    navSettings.hiddenSidebarItems = ['graph']
    const view = await render(
      <div className="h-[560px] w-11">
        <TooltipProvider>
          <RouterProvider initialRoute={{ kind: 'today' }}>
            <SidebarCollapsedRail graph={GRAPH} context={makeContext()} />
          </RouterProvider>
        </TooltipProvider>
      </div>,
    )

    await expect
      .element(view.getByRole('button', { name: 'Daily notes' }))
      .toHaveAttribute('aria-current', 'page')
    expect(view.getByRole('button', { name: 'Graph' }).query()).toBeNull()

    // Every icon button on the rail shares one horizontal center axis.
    const buttons = [...view.container.querySelectorAll('button')]
    const centers = buttons.map((button) => {
      const rect = button.getBoundingClientRect()
      return Math.round((rect.left + rect.right) * 2) / 4
    })
    expect(new Set(centers).size).toBe(1)

    await view.getByRole('button', { name: 'Toggle sidebar' }).click()
    expect(toggleSidebar).toHaveBeenCalledTimes(1)

    await view.getByRole('button', { name: 'Search' }).click()
    expect(openPalette).toHaveBeenCalledTimes(1)

    await view.getByRole('button', { name: 'Tasks' }).click()
    expect(navigate).toHaveBeenCalledWith({ kind: 'tasks' })

    await view.getByRole('button', { name: 'Expand sidebar (Notes)' }).click()
    expect(toggleSidebar).toHaveBeenCalledTimes(2)
  })
})
