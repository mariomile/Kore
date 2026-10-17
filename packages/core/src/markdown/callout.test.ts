import { describe, expect, it } from 'vitest'
import {
  calloutLabel,
  formatCalloutBlock,
  parseCalloutMarker,
  requoteCalloutBlock,
  separateCalloutTitles,
} from './callout'

describe('parseCalloutMarker', () => {
  it('reads a kind case-insensitively, GitHub and Obsidian spellings alike', () => {
    expect(parseCalloutMarker('[!NOTE]')).toMatchObject({
      kind: 'note',
      title: null,
      fold: 'none',
    })
    expect(parseCalloutMarker('[!Warning]')).toMatchObject({
      kind: 'warning',
      type: 'warning',
    })
    expect(parseCalloutMarker('[!example]')).toMatchObject({ kind: 'example' })
    expect(parseCalloutMarker('[!bug]')).toMatchObject({ kind: 'bug' })
  })

  it('resolves Obsidian aliases onto their kind and keeps the typed token', () => {
    expect(parseCalloutMarker('[!tldr]')).toMatchObject({
      kind: 'abstract',
      type: 'tldr',
    })
    expect(parseCalloutMarker('[!FAQ]')).toMatchObject({
      kind: 'question',
      type: 'faq',
    })
    expect(parseCalloutMarker('[!important]')).toMatchObject({ kind: 'tip' })
    expect(parseCalloutMarker('[!caution]')).toMatchObject({ kind: 'warning' })
    expect(parseCalloutMarker('[!error]')).toMatchObject({ kind: 'danger' })
    expect(parseCalloutMarker('[!cite]')).toMatchObject({ kind: 'quote' })
  })

  it('styles an unknown type as a note, as Obsidian does', () => {
    expect(parseCalloutMarker('[!my-type] Hi')).toMatchObject({
      kind: 'note',
      type: 'my-type',
      title: 'Hi',
    })
  })

  it('reads the fold sign and where the title starts', () => {
    expect(parseCalloutMarker('[!faq]- Are callouts foldable?')).toEqual({
      kind: 'question',
      type: 'faq',
      title: 'Are callouts foldable?',
      fold: 'closed',
      markerLength: 8,
    })
    expect(parseCalloutMarker('[!note]+')).toMatchObject({
      fold: 'open',
      markerLength: 8,
    })
  })

  it('rejects ordinary quoted prose', () => {
    expect(parseCalloutMarker('a quote')).toBeNull()
    expect(parseCalloutMarker('[note]')).toBeNull()
    expect(parseCalloutMarker('[!note]title without a gap')).toBeNull()
    expect(parseCalloutMarker('[! note]')).toBeNull()
  })
})

describe('calloutLabel', () => {
  it('uses the title, else the typed token capitalized', () => {
    expect(calloutLabel(parseCalloutMarker('[!tip] Ship it')!)).toBe('Ship it')
    expect(calloutLabel(parseCalloutMarker('[!FAQ]')!)).toBe('Faq')
  })
})

describe('formatCalloutBlock', () => {
  it('inserts a typed empty callout the parser accepts', () => {
    const markdown = formatCalloutBlock('example')
    expect(markdown).toBe('> [!EXAMPLE]\n> \n')
    expect(parseCalloutMarker(markdown.split('\n')[0]!.replace(/^>\s?/, ''))).toMatchObject({
      kind: 'example',
      title: null,
    })
  })
})

describe('separateCalloutTitles', () => {
  it('splits the title line from a body on the next line, nested too', () => {
    expect(separateCalloutTitles('> [!note]- Title\n> body\n\n> > [!tip]\n> > inner')).toBe(
      '> [!note]- Title\n>\n> body\n\n> > [!tip]\n> >\n> > inner',
    )
  })

  it('leaves plain quotes, lone titles and fenced code alone', () => {
    const untouched = '> quote\n> [!note] not first\n\n> [!tip] alone\n\n```\n> [!note] x\n> y\n```'
    expect(separateCalloutTitles(untouched)).toBe(untouched)
    const longFence = '````\n```\n> [!note] x\n> y\n````'
    expect(separateCalloutTitles(longFence)).toBe(longFence)
  })
})

describe('requoteCalloutBlock', () => {
  it('quotes a dedented callout paragraph again and leaves prose alone', () => {
    expect(requoteCalloutBlock('[!faq]- Why?\nBecause.')).toBe('> [!faq]- Why?\n> Because.')
    expect(requoteCalloutBlock('Plain [[Roadmap]] mention')).toBe('Plain [[Roadmap]] mention')
  })
})
