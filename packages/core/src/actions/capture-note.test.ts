import { describe, expect, it } from 'vitest'
import { captureNoteSource, retitleDailyEntry, withDescription, withTitle } from './capture-note'
import type { CaptureEnvelope } from './capture-envelope'
import type { CaptureIdentity } from './capture-identity'

const BASE = 'capture-2026-06-11-153022-845-7c9e'

describe('retitleDailyEntry', () => {
  it('rewrites the entry when the link text still mirrors the old title', () => {
    const daily = `## Links\n\n- [[${BASE}|Old Title]]\n`
    expect(retitleDailyEntry(daily, BASE, 'Old Title', 'New Title')).toBe(
      `## Links\n\n- [[${BASE}|New Title]]\n`,
    )
  })

  it('leaves an edited link text alone — the user’s text wins', () => {
    const daily = `## Links\n\n- [[${BASE}|my own words]]\n`
    expect(retitleDailyEntry(daily, BASE, 'Old Title', 'New Title')).toBe(daily)
  })

  it('is a no-op when the title did not change', () => {
    const daily = `## Links\n\n- [[${BASE}|Same]]\n`
    expect(retitleDailyEntry(daily, BASE, 'Same', 'Same')).toBe(daily)
  })

  it('keeps `$` sequences in titles literal', () => {
    const daily = `## Links\n\n- [[${BASE}|Old Title]]\n`
    expect(retitleDailyEntry(daily, BASE, 'Old Title', 'Costs $& more')).toBe(
      `## Links\n\n- [[${BASE}|Costs $& more]]\n`,
    )
  })
})

describe('withTitle', () => {
  it('rewrites the H1 and the mirrored screenshot alt text', () => {
    const body = `# Old Title\n\n- URL: https://a.com\n- Type: #link\n\n## Screenshot\n\n![Old Title](assets/x.jpg)\n`
    expect(withTitle(body, 'New Title')).toBe(
      `# New Title\n\n- URL: https://a.com\n- Type: #link\n\n## Screenshot\n\n![New Title](assets/x.jpg)\n`,
    )
  })

  it('returns the body unchanged for an identical title', () => {
    const body = '# Same\n\n- Type: #link\n'
    expect(withTitle(body, 'Same')).toBe(body)
  })

  it('throws on a body without the drain-written heading', () => {
    expect(() => withTitle('- Type: #link\n', 'New Title')).toThrow(
      'capture note is missing its title heading',
    )
  })
})

const IDENTITY: CaptureIdentity = {
  base: BASE,
  date: '2026-06-11',
  notePath: `notes/${BASE}.md`,
  assetPath: `assets/${BASE}.jpg`,
}

function envelope(url: string): CaptureEnvelope {
  return {
    version: 1,
    id: '11111111-2222-3333-4444-555555555555',
    url,
    title: 'A page',
    capturedAt: '2026-06-11T15:30:22.845Z',
    source: 'extension',
  }
}

describe('capture note type metadata', () => {
  it('tags the capture with what the URL points at', async () => {
    const source = await captureNoteSource(
      envelope('https://github.com/mariomile/Kore'),
      IDENTITY,
      { hasScreenshot: false, status: 'done' },
    )
    expect(source).toContain('- Type: #capture #repo')
  })

  it('keeps the bare tag for a link it cannot classify', async () => {
    const source = await captureNoteSource(envelope('https://example.com/x'), IDENTITY, {
      hasScreenshot: false,
      status: 'done',
    })
    expect(source).toContain('- Type: #capture\n')
    expect(source).not.toContain('- Type: #capture #')
  })

  it('still finds the Type anchor when the capture is typed', () => {
    const body = '# T\n\n- URL: https://youtu.be/abc\n- Type: #link #video\n'
    expect(withDescription(body, 'A talk.')).toContain(
      '- Type: #link #video\n- Description: A talk.',
    )
  })
})
