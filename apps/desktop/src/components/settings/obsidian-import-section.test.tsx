import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VAULT_LAYOUT, type ObsidianImportReport } from '@reflect/core'
import type { ObsidianImportDryRunState } from '@/hooks/use-obsidian-import-dry-run'

const run = vi.hoisted(() => vi.fn())
const dryRun = vi.hoisted((): { state: Omit<ObsidianImportDryRunState, 'run'> } => ({
  state: { report: undefined, isRunning: false, error: null },
}))

vi.mock('@/providers/graph-provider', () => ({ useGraph: () => ({ graph: null }) }))
vi.mock('@/hooks/use-obsidian-import-dry-run', () => ({
  useObsidianImportDryRun: () => ({ ...dryRun.state, run }),
}))

const { ObsidianImportSection } = await import('./obsidian-import-section')

const REPORT: ObsidianImportReport = {
  layout: {
    ...DEFAULT_VAULT_LAYOUT,
    dailyFolder: 'Journal/Daily',
    dailyFormat: 'DD-MM-YYYY',
    attachmentFolder: 'Resources/_attachments',
    obsidian: true,
  },
  moves: { daily: 878, attachment: 2362, template: 0 },
  conflicts: [
    {
      from: 'Journal/Daily/09-10-2026.md',
      to: 'daily/2026-10-09.md',
      kind: 'daily',
      reason: 'occupied',
    },
  ],
  rewrittenNotes: 40,
  rewrittenLinks: 120,
  normalizing: 3000,
  lossy: ['Knowledge/Odd.md'],
  compat: { groups: [], affectedNotes: 0, scanned: 5116, skipped: 0 },
}

afterEach(() => {
  dryRun.state = { report: undefined, isRunning: false, error: null }
  vi.clearAllMocks()
})

describe('ObsidianImportSection', () => {
  it('runs the preview only when asked', async () => {
    await render(<ObsidianImportSection />)

    expect(run).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'Preview' }).click()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('lists what the conversion would do and the files it leaves alone', async () => {
    dryRun.state = { report: REPORT, isRunning: false, error: null }
    await render(<ObsidianImportSection />)

    await expect
      .element(page.getByText('Preview of 5,116 notes. Nothing has been written.'))
      .toBeVisible()
    await expect
      .element(
        page.getByText('878 daily notes move from Journal/Daily/DD-MM-YYYY to daily/YYYY-MM-DD.'),
      )
      .toBeVisible()
    await expect
      .element(page.getByText('2,362 attachments move from Resources/_attachments to assets/.'))
      .toBeVisible()
    await expect
      .element(page.getByText('120 links are updated to the new paths, in 40 notes.'))
      .toBeVisible()

    await page.getByRole('button', { name: /1 note is copied unchanged/ }).click()
    await expect.element(page.getByText('Knowledge/Odd.md')).toBeVisible()
    await page.getByRole('button', { name: /1 file stays in place/ }).click()
    await expect
      .element(page.getByText('Journal/Daily/09-10-2026.md → daily/2026-10-09.md'))
      .toBeVisible()
  })
})
