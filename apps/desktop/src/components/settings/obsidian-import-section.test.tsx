import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_VAULT_LAYOUT,
  importMappingFromLayout,
  type ObsidianImportReport,
  type ObsidianImportSource,
} from '@reflect/core'
import type { ObsidianImportDryRunState } from '@/hooks/use-obsidian-import-dry-run'

const run = vi.hoisted(() => vi.fn())
const setMapping = vi.hoisted(() => vi.fn())
type State = Omit<ObsidianImportDryRunState, 'run' | 'setMapping'>
const EMPTY: State = {
  source: undefined,
  report: undefined,
  mapping: undefined,
  isRunning: false,
  error: null,
}
const dryRun = vi.hoisted((): { state: State | null } => ({ state: null }))

vi.mock('@/providers/graph-provider', () => ({ useGraph: () => ({ graph: null }) }))
vi.mock('@/hooks/use-obsidian-import-dry-run', () => ({
  useObsidianImportDryRun: () => ({ ...(dryRun.state ?? EMPTY), run, setMapping }),
}))

const { ObsidianImportSection } = await import('./obsidian-import-section')

const LAYOUT = {
  ...DEFAULT_VAULT_LAYOUT,
  dailyFolder: 'Journal/Daily',
  dailyFormat: 'DD-MM-YYYY',
  attachmentFolder: 'Resources/_attachments',
  obsidian: true,
}
const MAPPING = importMappingFromLayout(LAYOUT)
const SOURCE: ObsidianImportSource = {
  layout: LAYOUT,
  notes: [],
  attachments: [],
  folders: ['Journal', 'Journal/Daily', 'Resources', 'Resources/_attachments'],
  skipped: 0,
}
const REPORT: ObsidianImportReport = {
  mapping: MAPPING,
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
  excluded: 0,
  compat: { groups: [], affectedNotes: 0, scanned: 5116, skipped: 0 },
}

const READ: State = {
  source: SOURCE,
  report: REPORT,
  mapping: MAPPING,
  isRunning: false,
  error: null,
}

afterEach(() => {
  dryRun.state = null
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
    dryRun.state = READ
    await render(<ObsidianImportSection />)

    await expect.element(page.getByText(/^Preview of 5,116 notes\./)).toBeVisible()
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

  it('shows the mapping read from the vault and sends edits back', async () => {
    dryRun.state = READ
    await render(<ObsidianImportSection />)

    await expect
      .element(page.getByRole('combobox', { name: 'Daily notes folder' }))
      .toHaveTextContent('Journal/Daily')
    await expect
      .element(page.getByRole('combobox', { name: 'Attachments folder' }))
      .toHaveTextContent('Resources/_attachments')
    await page.getByRole('textbox', { name: 'Daily note file name format' }).fill('YYYY')
    expect(setMapping).toHaveBeenLastCalledWith({
      ...MAPPING,
      daily: { folder: 'Journal/Daily', format: 'YYYY' },
    })
  })

  it('flags a daily format that cannot name one file per day', async () => {
    dryRun.state = {
      ...READ,
      mapping: { ...MAPPING, daily: { folder: 'Journal/Daily', format: 'dddd' } },
    }
    await render(<ObsidianImportSection />)

    await expect.element(page.getByRole('alert')).toHaveTextContent(/YYYY, MM/)
  })
})
