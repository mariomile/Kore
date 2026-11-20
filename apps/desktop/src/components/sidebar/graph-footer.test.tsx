import { render } from 'vitest-browser-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GraphInfo } from '@kore/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { CommandContext } from '@/lib/commands/types'
import type { UpdateState } from '@/lib/update-controller'
import { RouterProvider } from '@/routing/router'
import { GraphFooter } from './graph-footer'

const update = vi.hoisted(() => ({
  state: { phase: 'idle' } as UpdateState,
  supported: true,
  checkNow: vi.fn(async () => {}),
  install: vi.fn(async () => {}),
  restart: vi.fn(async () => {}),
}))

vi.mock('@/providers/update-provider', () => ({ useUpdate: () => update }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({
    recents: [],
    indexing: false,
    openRecent: vi.fn(),
    chooseGraph: vi.fn(),
  }),
}))
vi.mock('@/providers/sync-provider', () => ({
  useSync: () => ({ backup: { phase: 'idle' } }),
}))
vi.mock('@/hooks/use-graph-colors', () => ({
  useGraphColors: () => ({ colorFor: () => null, setColor: vi.fn() }),
}))
vi.mock('@/hooks/use-home-dir', () => ({ useHomeDir: () => null }))

const GRAPH: GraphInfo = { root: '/notes', name: 'Notes', generation: 1 }
const CONTEXT = { openPalette: vi.fn() } as unknown as CommandContext

function renderFooter() {
  return render(
    <TooltipProvider>
      <RouterProvider initialRoute={{ kind: 'today' }}>
        <GraphFooter graph={GRAPH} context={CONTEXT} />
      </RouterProvider>
    </TooltipProvider>,
  )
}

afterEach(() => {
  update.state = { phase: 'idle' }
  update.supported = true
  update.install.mockClear()
  update.restart.mockClear()
})

describe('GraphFooter update button', () => {
  it('stays hidden when idle and surfaces an install button when an update is available', async () => {
    const idleView = await renderFooter()
    expect(idleView.getByRole('button', { name: /update/i }).query()).toBeNull()
    await idleView.unmount()

    update.state = { phase: 'available', version: '0.129.0' }
    const availableView = await renderFooter()
    const button = availableView.getByRole('button', { name: 'Install update 0.129.0' })
    await expect.element(button).toBeVisible()
    await button.click()
    expect(update.install).toHaveBeenCalledTimes(1)
  })

  it('restarts when ready and retries when an install fails', async () => {
    update.state = { phase: 'ready', version: '0.129.0' }
    const readyView = await renderFooter()
    await readyView.getByRole('button', { name: 'Restart to update to 0.129.0' }).click()
    expect(update.restart).toHaveBeenCalledTimes(1)
    await readyView.unmount()

    update.state = { phase: 'error', message: 'network lost', during: 'install' }
    const failedView = await renderFooter()
    await failedView.getByRole('button', { name: 'Retry update install' }).click()
    expect(update.install).toHaveBeenCalledTimes(1)
  })
})
