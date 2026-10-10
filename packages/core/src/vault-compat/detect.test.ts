import { describe, expect, it } from 'vitest'
import { detectCompatFindings } from './detect'
import { buildVaultCompatReport } from './scan'

const NOTE = [
  '---',
  'created: <% tp.date.now("YYYY-MM-DD") %>',
  '---',
  '# Weekly review',
  '',
  'Status: `= this.status`',
  '',
  '```dataview',
  'TABLE file.mtime FROM #project',
  '```',
  '',
  '```ad-warning',
  'Careful.',
  '```',
  '',
  '```mermaid',
  '%% roadmap',
  'gantt',
  '  title Plan',
  '```',
  '',
  '```mermaid',
  'flowchart LR',
  '  A --> B',
  '```',
  '',
  'See ![[Board.canvas]] and [sketch](Drawings/Idea.excalidraw.md).',
].join('\n')

describe('detectCompatFindings', () => {
  it('finds each unsupported kind once, with the Mermaid diagram type', () => {
    expect(detectCompatFindings('Weekly.md', NOTE)).toEqual([
      { kind: 'templater', detail: null },
      { kind: 'dataview', detail: null },
      { kind: 'admonition', detail: null },
      { kind: 'mermaid', detail: 'gantt' },
      { kind: 'canvas', detail: null },
      { kind: 'excalidraw', detail: null },
    ])
  })

  it('ignores syntax quoted inside other code blocks and notes Kore renders', () => {
    const source = [
      '````markdown',
      '```dataview',
      'LIST',
      '```',
      '<% tp.file.title %> and [[Board.canvas]]',
      '````',
      '> [!note] A callout',
      '![[Projects.base#Table]]',
    ].join('\n')
    expect(detectCompatFindings('Docs.md', source)).toEqual([])
    expect(detectCompatFindings('Drawings/Idea.excalidraw.md', '')).toEqual([
      { kind: 'excalidraw', detail: null },
    ])
  })
})

describe('buildVaultCompatReport', () => {
  it('groups notes by kind in list order and counts each note once', () => {
    const report = buildVaultCompatReport(
      [
        { path: 'b/Plan.md', findings: [{ kind: 'mermaid', detail: 'pie' }] },
        {
          path: 'a/Board.md',
          findings: [
            { kind: 'canvas', detail: null },
            { kind: 'dataview', detail: null },
          ],
        },
      ],
      { scanned: 10, skipped: 1 },
    )
    expect(
      report.groups.map((group) => [group.kind, group.notes.map((note) => note.title)]),
    ).toEqual([
      ['dataview', ['Board']],
      ['mermaid', ['Plan']],
      ['canvas', ['Board']],
    ])
    expect(report.groups[1]?.notes[0]?.details).toEqual(['pie'])
    expect(report).toMatchObject({ affectedNotes: 2, scanned: 10, skipped: 1 })
  })
})
