import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { agentRoutinesSchema, type Settings } from '@reflect/core'

const effects = vi.hoisted(() => ({
  exportBackup: vi.fn(async () => {}),
  restoreBackup: vi.fn(),
  save: vi.fn(async () => '/backups/work.zip'),
  open: vi.fn(),
  openRecent: vi.fn(async () => true),
  update: vi.fn<(patch: Partial<Settings>) => void>(),
  flush: vi.fn(async () => {}),
}))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  exportGraphBackup: effects.exportBackup,
  restoreGraphBackup: effects.restoreBackup,
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: effects.save, open: effects.open }))
vi.mock('@/lib/platform', () => ({ isNativeShell: () => true }))
vi.mock('@/lib/platform-surface', () => ({ isMobileSurface: () => false }))
vi.mock('@/editor/open-documents', () => ({
  flushOpenDocuments: effects.flush,
  dirtyOpenPaths: () => [],
}))
vi.mock('@/components/ui/toast', () => ({ toast: { add: vi.fn() } }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({
    graph: { root: '/work', name: 'Work', generation: 7 },
    openRecent: effects.openRecent,
  }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { agentRoutines: [] },
    whenSettingsLoaded: async () => 'loaded',
    updateSettingsWith: (updater: (current: { agentRoutines: [] }) => Partial<Settings>) =>
      effects.update(updater({ agentRoutines: [] })),
  }),
}))

const { GraphBackupSection } = await import('./graph-backup-section')
const { exportGraphBackup, restoreGraphBackup } = await import('@reflect/core')
afterEach(async () => {
  await cleanup()
  vi.clearAllMocks()
})

describe('GraphBackupSection', () => {
  it('flushes notes before exporting and restores routines paused into a new graph', async () => {
    const automations = agentRoutinesSchema.parse([
      {
        id: 'daily',
        graphRoot: '/work',
        name: 'Daily',
        agentSlug: 'curator',
        prompt: 'Review',
        schedule: { kind: 'daily', time: '08:00' },
        enabled: true,
      },
    ])
    expect(automations).toHaveLength(1)
    effects.open.mockResolvedValueOnce('/backups/work.zip').mockResolvedValueOnce('/restored')
    effects.restoreBackup.mockResolvedValueOnce({ root: '/restored/new', automations })
    await render(<GraphBackupSection />)
    await page.getByRole('button', { name: 'Export graph backup…' }).click()
    await expect.poll(() => effects.exportBackup.mock.calls.length).toBe(1)
    expect(exportGraphBackup).toHaveBeenCalledWith('/backups/work.zip', 7, [])
    expect(effects.flush.mock.invocationCallOrder[0]).toBeLessThan(
      effects.exportBackup.mock.invocationCallOrder[0] ?? 0,
    )
    await page.getByRole('button', { name: 'Restore graph backup…' }).click()
    await expect.poll(() => effects.openRecent.mock.calls.length).toBe(1)
    expect(restoreGraphBackup).toHaveBeenCalledWith('/backups/work.zip', '/restored')
    expect(effects.update).toHaveBeenCalledWith({
      agentRoutines: [
        expect.objectContaining({ graphRoot: '/restored/new', enabled: false, lastRunMs: null }),
      ],
    })
    expect(effects.openRecent).toHaveBeenCalledWith('/restored/new')
  })

  it('shows export failures in the settings surface', async () => {
    effects.exportBackup.mockRejectedValueOnce(new Error('Disk full'))
    await render(<GraphBackupSection />)
    await page.getByRole('button', { name: 'Export graph backup…' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Disk full')
  })
})
