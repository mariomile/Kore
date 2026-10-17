import { describe, expect, it } from 'vitest'
import { parseNote } from './extract'

function preview(body: string): string {
  return parseNote({ path: 'notes/n.md', source: body }).previewText
}

describe('parseNote — previewText', () => {
  it('drops Dataview query fences but keeps them in the search text', () => {
    const source = [
      '# Projects',
      '',
      '```dataview',
      'TABLE status FROM "Active"',
      '```',
      '',
      'The projects I am running this quarter.',
    ].join('\n')
    const parsed = parseNote({ path: 'notes/p.md', source })
    expect(parsed.previewText).toBe('Projects The projects I am running this quarter.')
    expect(parsed.text).toContain('TABLE status FROM')
  })

  it('drops every code, math, and HTML block', () => {
    const body = [
      '```dataviewjs',
      'dv.list(dv.pages())',
      '```',
      '',
      '    indented code',
      '',
      '```mermaid',
      'graph TD',
      '```',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      '<div class="banner">x</div>',
      '',
      '<!-- hidden -->',
      '',
      'Real prose.',
    ].join('\n')
    expect(preview(body)).toBe('Real prose.')
  })

  it('drops Templater tags in any form', () => {
    expect(preview('Created <% tp.date.now("YYYY-MM-DD") %> by <%tp.file.title%>.\n')).toBe(
      'Created by .',
    )
    expect(preview('<%*\nconst x = 1\ntR += x\n%>\nAfter the script.')).toBe('After the script.')
  })

  it('drops Obsidian comments, inline and across lines', () => {
    expect(preview('Before %% inline note %% after.')).toBe('Before after.')
    expect(preview('%%\nhidden\nlines\n%%\n\nVisible.')).toBe('Visible.')
  })

  it('never pairs a %% inside code with one outside it', () => {
    const body = [
      '```mermaid',
      '%% diagram comment',
      'graph TD',
      '```',
      '',
      'Kept prose %% c %% end.',
    ].join('\n')
    expect(preview(body)).toBe('Kept prose end.')
  })

  it('drops inline Dataview queries but keeps ordinary inline code', () => {
    expect(preview('Status: `= this.status` and `$= dv.current().file.name` with `npm i`.')).toBe(
      'Status: and with npm i.',
    )
  })

  it('drops callout markers but keeps the title and body', () => {
    expect(preview('> [!warning]- Heads up\n> The dates move.')).toBe('Heads up The dates move.')
    expect(preview('> > [!note] Nested\n> > body')).toBe('Nested body')
    expect(preview('>   [!tip] Spaced\n> body')).toBe('Spaced body')
  })

  it('is the plain text when nothing is noise', () => {
    const parsed = parseNote({
      path: 'notes/n.md',
      source: '# Title\n\nSome **bold** [[Link|alias]].',
    })
    expect(parsed.previewText).toBe(parsed.text)
  })
})
