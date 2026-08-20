import { describe, expect, it } from 'vitest'
import { buildExportDocument, needsTitleHeading, renderNoteBodyHtml } from './note-export'

describe('needsTitleHeading', () => {
  it('is false when the body opens with its own H1', () => {
    expect(needsTitleHeading('# Project Atlas\n\nBody')).toBe(false)
    expect(needsTitleHeading('\n\n# Late Start')).toBe(false)
  })

  it('is true for heading-less bodies (dailies, frontmatter titles)', () => {
    expect(needsTitleHeading('Just a paragraph')).toBe(true)
    expect(needsTitleHeading('## Deep heading first')).toBe(true)
    expect(needsTitleHeading('')).toBe(true)
  })
})

describe('buildExportDocument', () => {
  const base = {
    title: 'Project <Atlas> & "Co"',
    bodyHtml: '<div class="reflect-editor"><p>Hello</p></div>',
    css: '.reflect-editor { color: red; }',
    addTitleHeading: false,
    rootAttributes: { class: 'dark', 'data-theme': '', 'data-accent': 'purple' },
  }

  it('assembles a standalone themed document', () => {
    const html = buildExportDocument(base)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<html class="dark" data-accent="purple">')
    expect(html).not.toContain('data-theme')
    expect(html).toContain('<title>Project &lt;Atlas&gt; &amp; &quot;Co&quot;</title>')
    expect(html).toContain('.reflect-editor { color: red; }')
    expect(html).toContain(base.bodyHtml)
    expect(html).toContain('window.print()')
    expect(html).toContain('@media print')
  })

  it('adds an escaped H1 only when asked', () => {
    expect(buildExportDocument(base)).not.toContain('<h1 class="lore-export-title">')
    const withHeading = buildExportDocument({ ...base, addTitleHeading: true })
    expect(withHeading).toContain(
      '<h1 class="lore-export-title">Project &lt;Atlas&gt; &amp; &quot;Co&quot;</h1>',
    )
  })
})

describe('renderNoteBodyHtml', () => {
  it('serializes the meowdown rendering with tasks and wiki links', async () => {
    const html = await renderNoteBodyHtml(
      '# Title\n\nSee [[Project Atlas]].\n\n+ [ ] call the bank\n',
      1,
    )
    expect(html).toContain('reflect-editor')
    expect(html).toContain('Title')
    expect(html).toContain('Project Atlas')
    expect(html).toContain('call the bank')
    // The off-screen host is cleaned up.
    expect(document.querySelectorAll('.reflect-editor')).toHaveLength(0)
  })

  it('keeps remote image URLs and drops nothing on unresolvable ones', async () => {
    const html = await renderNoteBodyHtml('![cat](https://example.com/cat.png)\n', 1)
    expect(html).toContain('https://example.com/cat.png')
  })
})
