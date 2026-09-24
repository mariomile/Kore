import { describe, expect, it } from 'vitest'
import { parseBodyEmbeds, sameBodyEmbeds } from './body-embeds'

const BODY = [
  '- a line',
  '```embed',
  'https://example.com/video',
  '```',
  '![[Project plan#Goals]]',
].join('\n')

describe('sameBodyEmbeds', () => {
  it('treats typing around unchanged embeds as the same embeds', () => {
    const edited = BODY.replace('- a line', '- a longer line with more words')
    expect(sameBodyEmbeds(parseBodyEmbeds(BODY), parseBodyEmbeds(edited))).toBe(true)
  })

  it('reports a changed embed or transclusion target', () => {
    const base = parseBodyEmbeds(BODY)
    expect(sameBodyEmbeds(base, parseBodyEmbeds(BODY.replace('video', 'talk')))).toBe(false)
    expect(sameBodyEmbeds(base, parseBodyEmbeds(BODY.replace('#Goals', '#Risks')))).toBe(false)
  })
})
