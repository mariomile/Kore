import { describe, expect, it } from 'vitest'
import { parseBaseFile } from './base-file'
import { evaluateBaseExpression } from './evaluate'
import type { BaseNoteRow } from './values'
import { createBaseVault, runBaseView } from './run-view'

const NOW = new Date(2026, 9, 10, 12, 0).getTime()
const DAY = 86_400_000

function row(path: string, overrides: Partial<BaseNoteRow> = {}): BaseNoteRow {
  const title = (path.split('/').at(-1) ?? path).replace(/\.md$/, '')
  return {
    path,
    title,
    mtime: NOW - DAY,
    ctime: NOW - 10 * DAY,
    size: 1000,
    tags: [],
    properties: {},
    links: [],
    backlinks: [],
    ...overrides,
  }
}

const vault = createBaseVault([
  row('Active/Projects/Kore/Kore.md', {
    tags: ['type/project'],
    properties: { status: 'active' },
    mtime: NOW - 2 * DAY,
    backlinks: ['Journal/Daily/09-10-2026.md'],
  }),
  row('Active/Projects/Kore/Ship bases.md', {
    tags: ['flow/live'],
    properties: { status: 'in-progress', priority: 2 },
  }),
  row('Active/Projects/Captoo/Captoo.md', {
    tags: ['type/project'],
    properties: { status: 'hold' },
    mtime: NOW - 30 * DAY,
  }),
  row('CRM/People/Ada.md', {
    tags: ['type/person'],
    properties: { last_contact: '2026-08-01' },
  }),
  row('Journal/Daily/09-10-2026.md', { links: ['Active/Projects/Kore/Kore.md'] }),
])

function evaluate(source: string, path: string): unknown {
  const target = vault.rows.find((entry) => entry.path === path)!
  return evaluateBaseExpression(source, {
    row: target,
    now: NOW,
    formulas: {},
    titleOf: vault.titleOf,
    resolve: vault.resolve,
  })
}

describe('Bases expressions', () => {
  it('reads file fields, folders, tags and properties', () => {
    const kore = 'Active/Projects/Kore/Kore.md'
    expect(evaluate('file.basename == file.folder.split("/")[2]', kore)).toBe(true)
    expect(evaluate('file.inFolder("Active/Projects") && file.hasTag("type")', kore)).toBe(true)
    expect(evaluate('status == "active" && file.ext == "md"', kore)).toBe(true)
    expect(evaluate('!file.backlinks', 'CRM/People/Ada.md')).toBe(true)
    expect(evaluate('file.backlinks.length', kore)).toBe(1)
    expect(evaluate('file.hasLink("Kore")', 'Journal/Daily/09-10-2026.md')).toBe(true)
  })

  it('does date and duration arithmetic like Obsidian', () => {
    const ada = 'CRM/People/Ada.md'
    expect(evaluate('(now() - file.mtime).days.round(0)', ada)).toBe(1)
    expect(evaluate('(today() - date(last_contact)).days > 30', ada)).toBe(true)
    expect(evaluate('date(last_contact).format("DD/MM/YYYY")', ada)).toBe('01/08/2026')
    expect(evaluate('if(missing, "yes", "—")', ada)).toBe('—')
    expect(evaluate('file.tags.filter(value.startsWith("type/")).join(", ")', ada)).toBe(
      'type/person',
    )
  })
})

describe('runBaseView', () => {
  const definition = parseBaseFile(`
filters:
  or:
    - and:
        - file.inFolder("Active/Projects")
        - file.basename == file.folder.split("/")[2]
    - file.hasTag("flow/live")
formulas:
  days_idle: (now() - file.mtime).days.round(0)
  kind: if(file.basename == file.folder.split("/")[2], "Progetto", "Task")
properties:
  formula.days_idle:
    displayName: Days idle
views:
  - type: table
    name: Stale
    filters:
      and:
        - formula.days_idle > 7
    order:
      - file.name
      - formula.days_idle
  - type: kanban
    name: Progetti
    filters: 'formula.kind == "Progetto"'
    groupBy:
      property: status
      direction: ASC
    groupOrder: [active, hold]
    sort:
      - property: formula.days_idle
        direction: DESC
`)

  it('filters, computes formulas and labels columns', () => {
    const result = runBaseView(definition, 0, vault, NOW)
    expect(result.columns.map((column) => column.label)).toEqual(['Name', 'Days idle'])
    expect(result.rows.map((entry) => entry.title)).toEqual(['Captoo'])
    expect(result.rows[0]!.cells.map((cell) => cell.text)).toEqual(['Captoo', '30'])
    expect(result.rows[0]!.cells[0]!.links).toEqual([
      { path: 'Active/Projects/Captoo/Captoo.md', title: 'Captoo' },
    ])
  })

  it('groups a plugin kanban view in its declared column order', () => {
    const result = runBaseView(definition, 1, vault, NOW)
    expect(result.layout).toBe('board')
    expect(result.approximated).toBe(true)
    expect(
      result.groups?.map((group) => [group.key, group.rows.map((entry) => entry.title)]),
    ).toEqual([
      ['active', ['Kore']],
      ['hold', ['Captoo']],
    ])
  })

  it('treats a broken filter as no match instead of failing the view', () => {
    const broken = parseBaseFile('filters: file.nope(')
    expect(runBaseView(broken, 0, vault, NOW).rows).toEqual([])
  })
})
