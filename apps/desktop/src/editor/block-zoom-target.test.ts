import { markdownToDoc } from '@meowdown/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { describe, expect, it } from 'vitest'
import {
  crumbsFor,
  enclosingHeadings,
  parentTarget,
  sectionEnd,
  targetAt,
  type ZoomTarget,
} from './block-zoom-target'

const NOTE = [
  '# Daily',
  '',
  '## Work',
  '',
  'Intro paragraph',
  '',
  '- DeepAgent',
  '  - call with Luca',
  '- Buildrs',
  '',
  '### Calls',
  '',
  'Call notes',
  '',
  '## Home',
  '',
  'Groceries',
  '',
].join('\n')

const doc: ProseMirrorNode = markdownToDoc(NOTE)

/** The position just inside the first text that starts with `text`. */
function posOf(text: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.startsWith(text) === true) {
      found = pos
    }
    return found === -1
  })
  if (found === -1) {
    throw new Error(`no text starts with ${text}`)
  }
  return found + 1
}

/** The text a zoom shows, block by block. */
function shown(target: ZoomTarget | null): string[] {
  if (target === null) {
    return ['whole note']
  }
  if (target.kind === 'list') {
    return [doc.nodeAt(target.root)?.textContent ?? '']
  }
  const texts: string[] = []
  doc.nodesBetween(target.from, target.to, (node, pos) => {
    if (pos >= target.from && pos < target.to) {
      texts.push(node.textContent)
    }
    return false
  })
  return texts
}

function headingPos(text: string): number {
  return doc.resolve(posOf(text)).before(1)
}

describe('block zoom target', () => {
  it('zooms the innermost list item around the caret', () => {
    expect(shown(targetAt(doc, doc.resolve(posOf('call with'))))).toEqual(['call with Luca'])
    expect(shown(targetAt(doc, doc.resolve(posOf('DeepAgent'))))).toEqual([
      'DeepAgentcall with Luca',
    ])
  })

  it('zooms a heading to its section and a paragraph alone', () => {
    expect(shown(targetAt(doc, doc.resolve(posOf('Work'))))).toEqual([
      'Work',
      'Intro paragraph',
      'DeepAgentcall with Luca',
      'Buildrs',
      'Calls',
      'Call notes',
    ])
    expect(shown(targetAt(doc, doc.resolve(posOf('Intro'))))).toEqual(['Intro paragraph'])
  })

  it('ends a section at the next heading of its level or above, else at the end', () => {
    expect(sectionEnd(doc, headingPos('Calls'), 3)).toBe(headingPos('Home'))
    expect(sectionEnd(doc, headingPos('Home'), 2)).toBe(doc.content.size)
  })

  it('leaves the leading title out of the enclosing headings', () => {
    const levels = enclosingHeadings(doc, headingPos('Call notes')).map(({ level }) => level)
    expect(levels).toEqual([2, 3])
    expect(enclosingHeadings(doc, headingPos('Calls')).map(({ level }) => level)).toEqual([2])
  })

  it('steps out item, section, outer section, then the whole note', () => {
    let target = targetAt(doc, doc.resolve(posOf('call with')))
    const steps: string[][] = []
    while (target !== null) {
      target = parentTarget(doc, target)
      steps.push(shown(target).slice(0, 1))
    }
    expect(steps).toEqual([['DeepAgentcall with Luca'], ['Work'], ['whole note']])
    const calls = targetAt(doc, doc.resolve(posOf('Call notes')))
    expect(calls === null ? null : shown(parentTarget(doc, calls))[0]).toBe('Calls')
  })

  it('builds crumbs from the note title down to the parent item', () => {
    const target = targetAt(doc, doc.resolve(posOf('call with')))
    expect(target === null ? [] : crumbsFor(doc, target).map(({ label }) => label)).toEqual([
      'Daily',
      'Work',
      'DeepAgent',
    ])
  })
})
