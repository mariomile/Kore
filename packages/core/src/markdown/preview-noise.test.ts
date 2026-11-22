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
    expect(parsed.previewText).toBe('The projects I am running this quarter.')
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
      source: 'Some **bold** [[Link]].\n\n- one _item_\n- [ ] a task',
    })
    expect(parsed.previewText).toBe('Some bold Link. one item a task')
    expect(parsed.previewText).toBe(parsed.text)
  })

  // The three cards from Mario's iPhone Notes grid (0.136.0) that showed raw
  // Markdown, as the notes are written in the vault.
  describe('real cards that showed Markdown', () => {
    it('Eureka Labs: a rule and an empty section leave only the sentence', () => {
      const parsed = parseNote({
        path: 'CRM/Companies/Eureka Labs.md',
        source: '# Eureka Labs\n\nAndrej Karpathy\n\n---\n\n## Note\n',
      })
      expect(parsed.previewText).toBe('Andrej Karpathy')
      expect(parsed.text).toBe('Eureka Labs Andrej Karpathy Note')
    })

    it('EasyGen: the Info table never reaches the card', () => {
      const source = [
        '---',
        'tags: [company]',
        '---',
        '# EasyGen',
        '',
        'Azienda nel network di Mario.',
        '',
        '---',
        '',
        '## Info',
        '',
        '| Campo | Valore |',
        '| --- | --- |',
        '| Industry | |',
        '| Stage | |',
        '| Founded | |',
        '',
        '## Note',
        '',
      ].join('\n')
      const parsed = parseNote({ path: 'CRM/Companies/EasyGen.md', source })
      expect(parsed.previewText).toBe('Azienda nel network di Mario.')
      // Search keeps the cells as words, without pipes or dashes.
      expect(parsed.text).toBe(
        'EasyGen Azienda nel network di Mario. Info Campo Valore Industry Stage Founded Note',
      )
    })

    it('Notes Review: a property line is all the note says, so the card shows it', () => {
      const parsed = parseNote({
        path: 'Notes Review.md',
        source: '# Notes Review\n\nType: #meeting\n',
      })
      expect(parsed.previewText).toBe('Type: #meeting')
      expect(parsed.tags).toEqual(['meeting'])
    })
  })

  it('keeps table cells apart in the search text even without padding', () => {
    const parsed = parseNote({ path: 'notes/n.md', source: '|a|b|\n|-|-|\n|c|d|\n' })
    expect(parsed.text).toBe('a b c d')
    expect(parsed.previewText).toBe('c: d')
  })

  it('drops headings of every form, keeping the prose under them', () => {
    expect(preview('# One\n\nFirst.\n\n### Deep\n\nSecond.\n\nSetext\n===\n\nThird.')).toBe(
      'First. Second. Third.',
    )
    expect(preview('# [[Folder/Note|Note]]\n\nBody.')).toBe('Body.')
  })

  it('drops rules of every spelling', () => {
    expect(preview('Above.\n\n---\n\n***\n\n___\n\nBelow.')).toBe('Above. Below.')
  })

  it('drops tag lines while the note has prose: tags alone, labelled tags, bare URLs', () => {
    expect(preview('#meeting #work\n\nNotes from the call.')).toBe('Notes from the call.')
    expect(preview('Type: #meeting\nTags: #a #b/c\n\nNotes.')).toBe('Notes.')
    expect(preview('- Type: #meeting\n- URL: https://example.com/a\n- A real item')).toBe(
      'A real item',
    )
    expect(preview('> Type: #meeting\n> > #nested\n> The quote itself.')).toBe('The quote itself.')
  })

  it('keeps a field that says something: a word, a link, a Dataview value', () => {
    expect(preview('- Author: [[James Clear]]\n- Role: CEO\n- Site: [x](http://x.io)')).toBe(
      'Author: James Clear Role: CEO Site: x',
    )
    expect(preview('Attendees: [[Sarah Chen]], [[James Clear]]\n\nWe agreed.')).toBe(
      'Attendees: Sarah Chen, James Clear We agreed.',
    )
    expect(preview('status:: active\nDue Date:: 2026-11-22\n\nText.')).toBe(
      'status: active Due Date: 2026-11-22 Text.',
    )
    expect(preview('> [!info]\n> - status:: done')).toBe('status: done')
  })

  it('rewrites a table as one line', () => {
    const fields =
      '| Campo | Valore |\n| --- | --- |\n| Industry | SaaS |\n| Stage | |\n| HQ | [[Rome]] |'
    expect(preview(fields)).toBe('Industry: SaaS · HQ: Rome')
    expect(preview(`Intro.\n\n${fields}\n\nOutro.`)).toBe('Intro. Industry: SaaS · HQ: Rome Outro.')
    expect(preview('| Name | Role | City |\n| - | - | - |\n| Ada | CTO | |\n| Bo | | Rome |')).toBe(
      'Name, Role, City · Ada, CTO · Bo, Rome',
    )
    // A template nobody filled in says nothing.
    expect(preview('Text.\n\n| Campo | Valore |\n| --- | --- |\n| Industry | |')).toBe('Text.')
  })

  it('falls back to section headings and tag lines when the note has no prose', () => {
    expect(preview('# Title\n\n## Info\n\n| a | b |\n| - | - |\n\n---\n\n#tag\n')).toBe('Info #tag')
    expect(preview('# Title\n\n## Agenda\n\n## Decisions\n')).toBe('Agenda Decisions')
    expect(preview('# Title\n\n## Info\n\n| Campo | Valore |\n| - | - |\n| Stage | Seed |')).toBe(
      'Stage: Seed',
    )
  })

  it('keeps a tag or a colon inside a sentence', () => {
    expect(preview('Talked about #kore with Mario.')).toBe('Talked about #kore with Mario.')
    expect(preview('Decision: ship it on Monday.')).toBe('Decision: ship it on Monday.')
    expect(preview('Type: #meeting about pricing')).toBe('Type: #meeting about pricing')
    expect(preview('- [[Atomic Habits]] #book\n- [[Kore]]')).toBe('Atomic Habits #book Kore')
    expect(preview('Owner: [[Sarah Chen]] until June')).toBe('Owner: Sarah Chen until June')
  })

  it('keeps a sentence that ends like a property', () => {
    expect(preview('We talked about pricing Type: #meeting')).toBe(
      'We talked about pricing Type: #meeting',
    )
    expect(preview('We met for the first time: [[Sarah Chen]]')).toBe(
      'We met for the first time: Sarah Chen',
    )
    expect(preview('The plan for next week status:: active')).toBe(
      'The plan for next week status:: active',
    )
  })

  it('drops images and embeds, keeps links as their words', () => {
    expect(preview('Before ![alt text](shot.png) ![[photo.png]] ![[Other note]] after.')).toBe(
      'Before after.',
    )
    expect(preview('See [the docs](https://example.com) and [[Note]].')).toBe(
      'See the docs and Note.',
    )
  })

  it('drops inline HTML tags but keeps the words they wrap', () => {
    expect(preview('A <b>bold</b>ly set word<br>and <span class="x">more</span>.<BR/>End')).toBe(
      'A boldly set word and more. End',
    )
  })

  it('drops footnotes, both the reference and the definition', () => {
    expect(preview('A claim[^1] stands.\n\n[^1]: The source.')).toBe('A claim stands.')
  })

  it('previews as nothing only when the note says nothing', () => {
    expect(preview('# Title\n\n---\n\n![[photo.png]]\n')).toBe('')
  })

  it('reads an aliased link as its alias, as the editor shows it', () => {
    const parsed = parseNote({ path: 'notes/n.md', source: 'See [[Link|alias]].' })
    expect(parsed.previewText).toBe('See alias.')
    expect(parsed.text).toBe('See Link alias.')
  })
})
