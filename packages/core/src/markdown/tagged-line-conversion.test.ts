import { describe, expect, it } from 'vitest'
import { convertTaggedLineToNote } from './tagged-line-conversion'

describe('convertTaggedLineToNote', () => {
  it('strips the tag for the title and links back to it in the replacement', () => {
    expect(convertTaggedLineToNote('Standup with Sarah #meeting', 'meeting')).toEqual({
      title: 'Standup with Sarah',
      replacementLine: '[[Standup with Sarah]] #meeting',
    })
  })

  it('folds tag casing so #Meeting still matches "meeting"', () => {
    expect(convertTaggedLineToNote('Standup with Sarah #Meeting', 'meeting')).toEqual({
      title: 'Standup with Sarah',
      replacementLine: '[[Standup with Sarah]] #meeting',
    })
  })

  it('preserves a leading list marker', () => {
    expect(convertTaggedLineToNote('- Standup with Sarah #meeting', 'meeting')).toEqual({
      title: 'Standup with Sarah',
      replacementLine: '- [[Standup with Sarah]] #meeting',
    })
  })

  it('titles a bare tag line "Untitled"', () => {
    expect(convertTaggedLineToNote('#meeting', 'meeting')).toEqual({
      title: 'Untitled',
      replacementLine: '[[Untitled]] #meeting',
    })
  })

  it('flattens wiki links inside the line so the title is itself linkable', () => {
    const result = convertTaggedLineToNote('Lunch with [[James Clear|James]] #person', 'person')
    expect(result.title).toBe('Lunch with James')
    expect(result.replacementLine).toBe('[[Lunch with James]] #person')
  })

  it('leaves other tags on the line untouched', () => {
    expect(convertTaggedLineToNote('Standup with Sarah #meeting #urgent', 'meeting')).toEqual({
      title: 'Standup with Sarah #urgent',
      replacementLine: '[[Standup with Sarah #urgent]] #meeting',
    })
  })
})
