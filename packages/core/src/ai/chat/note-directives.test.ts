import { describe, expect, it } from 'vitest'
import { isSafeNoteDirectivePath, noteDirectiveTitle, parseNoteDirectives } from './note-directives'

describe('parseNoteDirectives', () => {
  it('splits a reply into markdown runs and note cards', () => {
    const segments = parseNoteDirectives(
      [
        'The launch plan lives here:',
        '::note{path="notes/launch-plan.md"}',
        'It slipped a week — see the daily:',
        '::note{path="daily/2026-08-20.md"}',
      ].join('\n'),
    )
    expect(segments).toEqual([
      { kind: 'markdown', text: 'The launch plan lives here:' },
      { kind: 'note', path: 'notes/launch-plan.md' },
      { kind: 'markdown', text: 'It slipped a week — see the daily:' },
      { kind: 'note', path: 'daily/2026-08-20.md' },
    ])
  })

  it('returns one markdown segment when nothing is directive-shaped', () => {
    const text = 'Just an answer with [[Atlas]] cited inline.'
    expect(parseNoteDirectives(text)).toEqual([{ kind: 'markdown', text }])
  })

  it('leaves an unsafe path in the text instead of making it clickable', () => {
    const evil = '::note{path="../../etc/passwd.md"}'
    expect(parseNoteDirectives(evil)).toEqual([{ kind: 'markdown', text: evil }])
  })

  it('keeps a directive inside a fenced code block literal', () => {
    const text = ['Use the syntax:', '```', '::note{path="notes/x.md"}', '```'].join('\n')
    expect(parseNoteDirectives(text)).toEqual([{ kind: 'markdown', text }])
  })

  it('ignores a directive embedded mid-sentence', () => {
    const text = 'see ::note{path="notes/x.md"} for details'
    expect(parseNoteDirectives(text)).toEqual([{ kind: 'markdown', text }])
  })
})

describe('isSafeNoteDirectivePath', () => {
  it('accepts plain relative markdown paths only', () => {
    expect(isSafeNoteDirectivePath('notes/atlas.md')).toBe(true)
    expect(isSafeNoteDirectivePath('daily/2026-08-21.md')).toBe(true)
    expect(isSafeNoteDirectivePath('Atlas.MD')).toBe(true)

    expect(isSafeNoteDirectivePath('')).toBe(false)
    expect(isSafeNoteDirectivePath('/etc/passwd.md')).toBe(false)
    expect(isSafeNoteDirectivePath('C:/vault/x.md')).toBe(false)
    expect(isSafeNoteDirectivePath(String.raw`notes\x.md`)).toBe(false)
    expect(isSafeNoteDirectivePath('notes/../secret.md')).toBe(false)
    expect(isSafeNoteDirectivePath('./notes/x.md')).toBe(false)
    expect(isSafeNoteDirectivePath('notes//x.md')).toBe(false)
    expect(isSafeNoteDirectivePath('notes/image.png')).toBe(false)
  })
})

describe('noteDirectiveTitle', () => {
  it('shows the file name without its extension', () => {
    expect(noteDirectiveTitle('notes/launch-plan.md')).toBe('launch-plan')
    expect(noteDirectiveTitle('daily/2026-08-21.md')).toBe('2026-08-21')
  })
})
