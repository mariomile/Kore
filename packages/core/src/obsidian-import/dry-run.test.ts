import { describe, expect, it } from 'vitest'
import { DEFAULT_VAULT_LAYOUT, type VaultLayout } from '../graph/vault-layout'
import { buildObsidianImportReport, type ImportFidelity } from './dry-run'
import { importMappingFromLayout } from './mapping'

const OBSIDIAN: VaultLayout = {
  ...DEFAULT_VAULT_LAYOUT,
  dailyFolder: 'Journal/Daily',
  dailyFormat: 'DD-MM-YYYY',
  attachmentFolder: 'Resources/_attachments',
  obsidian: true,
}

describe('buildObsidianImportReport', () => {
  it('counts moves, rewritten links, fidelity and plugin syntax without writing anything', () => {
    const seen: string[] = []
    const classify = (body: string): ImportFidelity => {
      seen.push(body)
      return body.includes('LOSSY') ? 'lossy' : body.includes('|---|') ? 'normalizing' : 'exact'
    }
    const report = buildObsidianImportReport({
      mapping: { ...importMappingFromLayout(OBSIDIAN), exclude: ['Archive'] },
      source: {
        notes: [
          {
            path: 'Journal/Daily/09-10-2026.md',
            content: '---\ntags:\n  - type/log\n---\nToday\n',
          },
          {
            path: 'Knowledge/A.md',
            content: 'Back to [[09-10-2026]] ![[Resources/_attachments/x.png]]\n',
          },
          { path: 'Knowledge/B.md', content: '|a|b|\n|---|---|\n|1|2|\n' },
          { path: 'Knowledge/C.md', content: 'LOSSY\n\n```dataview\nLIST\n```\n' },
          { path: 'Archive/D.md', content: 'LOSSY [[09-10-2026]]\n' },
        ],
        attachments: ['Resources/_attachments/x.png', 'Knowledge/y.png'],
        skipped: 1,
      },
      classify,
    })
    expect(report.moves).toEqual({ daily: 1, attachment: 1, template: 0 })
    expect(report.conflicts).toEqual([])
    expect(report.rewrittenNotes).toBe(1)
    expect(report.rewrittenLinks).toBe(2)
    expect(report.normalizing).toBe(1)
    expect(report.lossy).toEqual(['Knowledge/C.md'])
    expect(report.compat.groups.map((group) => group.kind)).toEqual(['dataview'])
    expect(report.compat.scanned).toBe(4)
    expect(report.compat.skipped).toBe(1)
    expect(report.excluded).toBe(1)
    // The classifier sees the converted body, frontmatter stripped.
    expect(seen).toContain('Back to [[2026-10-09]] ![[assets/x.png]]\n')
    expect(seen).toContain('Today\n')
  })
})
