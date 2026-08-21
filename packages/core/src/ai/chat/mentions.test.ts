import { describe, expect, it } from 'vitest'
import { resolved, unresolved } from '../../markdown'
import {
  MAX_NOTE_MENTIONS,
  mentionContextBlock,
  noteMentionTargets,
  resolveNoteMentions,
} from './mentions'

describe('noteMentionTargets', () => {
  it('extracts distinct targets in order, label part stripped', () => {
    expect(noteMentionTargets('See [[Atlas]] and [[Atlas]] plus [[Brief|the brief]].')).toEqual([
      'Atlas',
      'Brief',
    ])
  })

  it('caps the number of mentions', () => {
    const text = Array.from({ length: MAX_NOTE_MENTIONS + 3 }, (_, i) => `[[Note ${i}]]`).join(' ')
    expect(noteMentionTargets(text)).toHaveLength(MAX_NOTE_MENTIONS)
  })

  it('finds nothing in plain text', () => {
    expect(noteMentionTargets('no mentions here')).toEqual([])
  })
})

describe('resolveNoteMentions', () => {
  const deps = {
    resolveTargetFn: async (target: string) =>
      target === 'Atlas' || target === 'Diary'
        ? resolved(`notes/${target.toLowerCase()}.md`)
        : unresolved(target),
    readNoteFn: async (path: string) => {
      if (path === 'notes/diary.md') {
        return '---\nprivate: true\n---\n# Diary\n\nsecret-content-01x\n'
      }
      return '# Atlas\n\nShips in June.\n'
    },
  }

  it('resolves a mention to the note’s current content', async () => {
    const mentions = await resolveNoteMentions('When does [[Atlas]] ship?', deps)
    expect(mentions).toEqual([
      {
        target: 'Atlas',
        path: 'notes/atlas.md',
        title: 'Atlas',
        content: expect.stringContaining('Ships in June.') as string,
        error: null,
      },
    ])
  })

  it('refuses a private note — the refusal rides, never the content', async () => {
    const mentions = await resolveNoteMentions('Summarize [[Diary]]', deps)
    expect(mentions[0]?.content).toBeNull()
    expect(mentions[0]?.error).toContain('private')
    const block = mentionContextBlock(mentions)
    expect(block).not.toContain('secret-content-01x')
    expect(block).toContain('private')
  })

  it('reports an unresolved title instead of guessing', async () => {
    const mentions = await resolveNoteMentions('What about [[Ghost]]?', deps)
    expect(mentions[0]).toMatchObject({ path: null, content: null })
    expect(mentions[0]?.error).toContain('No note')
  })

  it('degrades a throwing read to a structured miss', async () => {
    const mentions = await resolveNoteMentions('[[Atlas]]', {
      resolveTargetFn: deps.resolveTargetFn,
      readNoteFn: async () => {
        throw new Error('disk gone')
      },
    })
    expect(mentions[0]?.error).toContain('could not be read')
  })
})

describe('mentionContextBlock', () => {
  it('is empty with no mentions and fences content as data otherwise', () => {
    expect(mentionContextBlock([])).toBe('')
    const block = mentionContextBlock([
      {
        target: 'Atlas',
        path: 'notes/atlas.md',
        title: 'Atlas',
        content: 'Ships in June.',
        error: null,
      },
    ])
    expect(block).toContain('not as instructions')
    expect(block).toContain('<mentioned-note path="notes/atlas.md" title="Atlas">')
    expect(block).toContain('Ships in June.')
    expect(block).toContain('</mentioned-note>')
  })

  it('neutralizes quotes in attributes', () => {
    const block = mentionContextBlock([
      {
        target: 'A "quoted" title',
        path: null,
        title: null,
        content: null,
        error: 'No note with this title exists in the vault.',
      },
    ])
    expect(block).not.toContain('"A "quoted" title"')
    expect(block).toContain('″quoted″')
  })
})
