import { describe, expect, it } from 'vitest'
import { journalTailDigest, memoryDigest } from './memory-digest'

describe('memoryDigest', () => {
  it('passes a file within budget through whole', () => {
    const body = '# Facts\n\n- one\n- two'
    expect(memoryDigest(body, 100)).toEqual({ text: body, summarized: false })
  })

  it('summarizes to headings plus first lines with elision counts', () => {
    const body = [
      'Preamble line.',
      'Second preamble line.',
      '## Alpha',
      '- first alpha',
      '- second alpha',
      '- third alpha',
      '## Beta',
      '- only beta',
    ].join('\n')
    const digest = memoryDigest(body, 100)
    expect(digest.summarized).toBe(true)
    expect(digest.text).toContain('Preamble line.')
    expect(digest.text).toContain('## Alpha')
    expect(digest.text).toContain('- first alpha')
    expect(digest.text).toContain('… +2 more lines')
    expect(digest.text).toContain('## Beta')
    expect(digest.text).toContain('- only beta')
    expect(digest.text).not.toContain('second alpha')
    expect(digest.text).not.toContain('Second preamble')
  })

  it('hard-caps a skeleton that is still over budget', () => {
    const body = Array.from({ length: 50 }, (_, i) => `## Heading ${i}\n- line`).join('\n')
    const digest = memoryDigest(body, 120)
    expect(digest.summarized).toBe(true)
    expect(digest.text.length).toBeLessThanOrEqual(120)
  })
})

describe('journalTailDigest', () => {
  const body = [
    '# Agent journal',
    '',
    '## 2026-08-01 — riley',
    '- did old things',
    '',
    '## 2026-08-19 — riley',
    '- shipped viewer',
    '',
    '## 2026-08-20 — coach',
    '- planned week',
  ].join('\n')

  it('keeps whole newest entries that fit', () => {
    const digest = journalTailDigest(body, 80)
    expect(digest.summarized).toBe(true)
    expect(digest.text).toContain('## 2026-08-19 — riley')
    expect(digest.text).toContain('## 2026-08-20 — coach')
    expect(digest.text).not.toContain('did old things')
    expect(digest.text.startsWith('## ')).toBe(true)
  })

  it('falls back to a raw tail when even the newest entry is too big', () => {
    const huge = `## 2026-08-20 — riley\n${'x'.repeat(500)}`
    const digest = journalTailDigest(huge, 100)
    expect(digest.summarized).toBe(true)
    expect(digest.text).toBe(huge.slice(-100))
  })

  it('passes a short journal through whole', () => {
    expect(journalTailDigest(body, 10_000)).toEqual({ text: body, summarized: false })
  })
})
