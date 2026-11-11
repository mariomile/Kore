import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_VAULT_LAYOUT,
  importMappingFromLayout,
  type ObsidianImportReport,
  type ObsidianImportSource,
} from '@kore/core'
import type { ObsidianConversionState } from '@/hooks/use-obsidian-conversion'
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

const openRecent = vi.hoisted(() => vi.fn(async () => true))
const convert = vi.hoisted(() => vi.fn())
const conversion = vi.hoisted((): { result: ObsidianConversionState['result'] } => ({
  result: null,
}))

vi.mock('@/providers/graph-provider', () => ({ useGraph: () => ({ graph: null, openRecent }) }))
vi.mock('@/lib/platform', () => ({ isNativeShell: () => true }))
vi.mock('@/hooks/use-obsidian-conversion', () => ({
  useObsidianConversion: (): ObsidianConversionState => ({
    convert,
    pending: false,
    progress: null,
    result: conversion.result,
    error: null,
  }),
}))
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
  config: { dailyNotes: null, app: null, templates: null },
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
  conversion.result = null
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

  it('converts into a folder the user picks', async () => {
    dryRun.state = READ
    await render(<ObsidianImportSection />)

    await page.getByRole('button', { name: 'Convert to a copy…' }).click()
    expect(convert).toHaveBeenCalledWith(MAPPING)
  })

  it('reports the copy and opens it as a graph', async () => {
    dryRun.state = READ
    conversion.result = {
      destination: '/Users/me/Vault (Kore)',
      files: 10_000,
      bytes: 1,
      symlinks: 0,
      written: 2990,
    }
    await render(<ObsidianImportSection />)

    await expect
      .element(page.getByText(/^Converted copy written to \/Users\/me\/Vault \(Kore\)/))
      .toBeVisible()
    await page.getByRole('button', { name: 'Open the copy' }).click()
    expect(openRecent).toHaveBeenCalledWith('/Users/me/Vault (Kore)')
  })

  it('does not convert with a daily format that cannot name one file per day', async () => {
    dryRun.state = {
      ...READ,
      mapping: { ...MAPPING, daily: { folder: 'Journal/Daily', format: 'dddd' } },
    }
    await render(<ObsidianImportSection />)

    await expect.element(page.getByRole('button', { name: 'Convert to a copy…' })).toBeDisabled()
  })
})
