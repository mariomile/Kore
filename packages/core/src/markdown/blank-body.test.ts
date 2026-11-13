import { describe, expect, it } from 'vitest'
import { isBlankListSkeleton } from './blank-body'

describe('isBlankListSkeleton', () => {
  it.each([
    ['nothing', ''],
    ['a newline', '\n'],
    ['one empty bullet', '-\n'],
    ['a seeded bullet', '- '],
    ['empty bullets nested by Tab', '- -\n    - -\n        -\n'],
    ['other bullet markers', '* \n+\n'],
  ])('treats %s as blank', (_label, body) => {
    expect(isBlankListSkeleton(body)).toBe(true)
  })

  it.each([
    ['a word', '- hello\n'],
    ['a thematic break', '---\n'],
    ['an empty task', '- [ ]\n'],
    ['a nested word', '- -\n    - x\n'],
    ['a dash word', '-x\n'],
  ])('keeps %s as content', (_label, body) => {
    expect(isBlankListSkeleton(body)).toBe(false)
  })
})
