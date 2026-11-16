import { describe, expect, it } from 'vitest'
import { parseBodyEmbeds, sameBodyEmbeds } from './body-embeds'

const BODY = [
  '- a line',
  '```embed',
  'https://example.com/video',
  '```',
  '![[Project plan#Goals]]',
].join('\n')

describe('parseBodyEmbeds', () => {
  it('leaves embed fences to the editor, which draws them in place', () => {
    expect(parseBodyEmbeds(BODY).transclusions).toHaveLength(1)
    expect(Object.keys(parseBodyEmbeds(BODY))).not.toContain('media')
  })
})

describe('sameBodyEmbeds', () => {
  it('treats typing around unchanged embeds as the same embeds', () => {
    const edited = BODY.replace('- a line', '- a longer line with more words')
    expect(sameBodyEmbeds(parseBodyEmbeds(BODY), parseBodyEmbeds(edited))).toBe(true)
  })

  it('reports a changed transclusion target', () => {
    const base = parseBodyEmbeds(BODY)
    expect(sameBodyEmbeds(base, parseBodyEmbeds(BODY.replace('#Goals', '#Risks')))).toBe(false)
  })
})
