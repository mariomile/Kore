import { describe, expect, it } from 'vitest'
import { DEFAULT_VAULT_LAYOUT, type VaultLayout } from '../graph/vault-layout'
import {
  buildObsidianConversion,
  convertObsidianSettings,
  type ImportCanonicalizer,
} from './convert'
import { importMappingFromLayout } from './mapping'

const OBSIDIAN: VaultLayout = {
  ...DEFAULT_VAULT_LAYOUT,
  dailyFolder: 'Journal/Daily',
  dailyFormat: 'DD-MM-YYYY',
  attachmentFolder: 'Resources/_attachments',
  templatesFolder: '_system/templates',
  obsidian: true,
}

const MAPPING = importMappingFromLayout(OBSIDIAN)

const CONFIG = {
  dailyNotes: JSON.stringify({
    format: 'DD-MM-YYYY',
    folder: 'Journal/Daily',
    template: '_system/templates/Daily-Note',
  }),
  app: JSON.stringify({
    attachmentFolderPath: 'Resources/_attachments',
    newFileFolderPath: '_inbox',
    userIgnoreFilters: ['.archive', 'Resources/_attachments/'],
  }),
  templates: JSON.stringify({ folder: '_system/templates', dateFormat: 'YYYY-MM-DD' }),
}

/** Tables are the stand-in for what Kore rewrites; `LOSSY` for what it can't save. */
const convert: ImportCanonicalizer = (body) => {
  if (body.includes('LOSSY')) {
    return { fidelity: 'lossy', canonical: body }
  }
  if (body.includes('|---|')) {
    return { fidelity: 'normalizing', canonical: body.replaceAll('|---|', '| --- |') }
  }
  return { fidelity: 'exact', canonical: body }
}

describe('buildObsidianConversion', () => {
  it('moves files, rewrites links and canonical Markdown, and keeps lossy text', () => {
    const conversion = buildObsidianConversion({
      mapping: { ...MAPPING, exclude: ['Archive'] },
      source: {
        config: CONFIG,
        notes: [
          { path: 'Journal/Daily/09-10-2026.md', content: '---\ntags: [log]\n---\n|a|\n|---|\n' },
          {
            path: 'Knowledge/A.md',
            content: 'See [[09-10-2026]] ![[Resources/_attachments/x.png]]\n',
          },
          { path: 'Knowledge/B.md', content: 'Nothing to change\n' },
          { path: 'Knowledge/C.md', content: 'LOSSY [[09-10-2026|that day]]\n|---|\n' },
          { path: 'Archive/D.md', content: '[[09-10-2026]]\n' },
        ],
        attachments: ['Resources/_attachments/x.png'],
      },
      convert,
    })

    expect(conversion.renames).toEqual([
      { from: 'Journal/Daily/09-10-2026.md', to: 'daily/2026-10-09.md', kind: 'daily' },
      { from: 'Resources/_attachments/x.png', to: 'assets/x.png', kind: 'attachment' },
    ])
    expect(conversion.skip).toEqual(['.git', '.reflect', 'Archive'])
    expect(conversion.canonical).toBe(1)
    expect(conversion.lossy).toBe(1)
    const writes = new Map(conversion.writes.map((write) => [write.path, write.contents]))
    // Frontmatter stays byte for byte; only the body is canonical.
    expect(writes.get('daily/2026-10-09.md')).toBe('---\ntags: [log]\n---\n|a|\n| --- |\n')
    expect(writes.get('Knowledge/A.md')).toBe('See [[2026-10-09]] ![[assets/x.png]]\n')
    expect(writes.has('Knowledge/B.md')).toBe(false)
    // A lossy note keeps its text: only its links follow the moves.
    expect(writes.get('Knowledge/C.md')).toBe('LOSSY [[2026-10-09|that day]]\n|---|\n')
    expect(writes.has('Archive/D.md')).toBe(false)
  })
})

describe('convertObsidianSettings', () => {
  it('points the copy’s Obsidian settings at the folders files moved into', () => {
    const writes = new Map(
      convertObsidianSettings(CONFIG, MAPPING).map((write) => [
        write.path,
        JSON.parse(write.contents) as unknown,
      ]),
    )
    expect(writes.get('.obsidian/daily-notes.json')).toEqual({
      format: 'YYYY-MM-DD',
      folder: 'daily',
      template: 'templates/Daily-Note',
    })
    expect(writes.get('.obsidian/app.json')).toEqual({
      attachmentFolderPath: 'assets',
      newFileFolderPath: '_inbox',
      userIgnoreFilters: ['.archive', 'assets/'],
    })
    expect(writes.get('.obsidian/templates.json')).toEqual({
      folder: 'templates',
      dateFormat: 'YYYY-MM-DD',
    })
  })

  it('leaves settings alone when no role moves, and unparseable files untouched', () => {
    const unmapped = { daily: null, attachments: null, templates: null, exclude: [] }
    expect(convertObsidianSettings(CONFIG, unmapped)).toEqual([])
    expect(
      convertObsidianSettings({ dailyNotes: '{oops', app: null, templates: null }, MAPPING),
    ).toEqual([])
  })
})
