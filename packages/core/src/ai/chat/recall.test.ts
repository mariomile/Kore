import { describe, expect, it } from 'vitest'
import type { RecallHit } from '../../indexing'
import {
  RECALL_MAX_HITS,
  recallContextBlock,
  recallForMessage,
  recallTermsFromMessage,
} from './recall'

function hit(overrides: Partial<RecallHit> = {}): RecallHit {
  return {
    path: 'notes/kore-v2.md',
    title: 'Kore V2',
    dailyDate: null,
    snippet: 'launch plan for the …',
    preview: 'launch plan',
    ...overrides,
  }
}

describe('recallTermsFromMessage', () => {
  it('keeps the message’s significant words, in order, deduplicated', () => {
    expect(recallTermsFromMessage('Com’era andata la call con Sarah Chen sul lancio?')).toEqual([
      'call',
      'Sarah',
      'Chen',
      'lancio',
    ])
  })

  it('drops stopwords in both languages, short words, and duplicates', () => {
    expect(
      recallTermsFromMessage('What did we decide about the pricing? Il pricing di cui parlavamo'),
    ).toEqual(['decide', 'pricing', 'parlavamo'])
  })

  it('ignores mentions, URLs, and code — they are not recall queries', () => {
    expect(
      recallTermsFromMessage(
        'Guarda [[Kore V2]] e https://example.com/spec poi `renderCard()` per favore, budget',
      ),
    ).toEqual(['Guarda', 'poi', 'favore', 'budget'])
  })

  it('caps the number of terms', () => {
    const message = Array.from({ length: 20 }, (_, index) => `parola${index}`).join(' ')
    expect(recallTermsFromMessage(message)).toHaveLength(8)
  })

  it('returns nothing for a message with no signal', () => {
    expect(recallTermsFromMessage('ok :) !!')).toEqual([])
  })
})

describe('recallForMessage', () => {
  it('drops stale public hits when the file is private or cannot be read', async () => {
    const recalled = await recallForMessage('pricing', [], {
      searchFn: async () => [
        hit(),
        hit({ path: 'notes/missing.md' }),
        hit({ path: 'notes/public.md' }),
      ],
      readNoteFn: async (path) => {
        if (path === 'notes/missing.md') throw new Error('unreadable')
        return path === 'notes/public.md' ? '# Public' : '---\nprivate: true\n---\n# Private'
      },
    })
    expect(recalled.map((entry) => entry.path)).toEqual(['notes/public.md'])
  })
  it('recalls ranked hits for the message terms, capped', async () => {
    const hits = [
      hit({ path: 'a.md', title: 'A' }),
      hit({ path: 'b.md', title: 'B' }),
      hit({ path: 'c.md', title: 'C' }),
      hit({ path: 'd.md', title: 'D' }),
    ]
    const recalled = await recallForMessage('vendite pricing lancio', [], {
      searchFn: async () => hits,
      readNoteFn: async () => '# Public',
    })
    expect(recalled).toHaveLength(RECALL_MAX_HITS)
    expect(recalled.map((entry) => entry.path)).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('excludes mentioned paths and mentioned titles', async () => {
    const hits = [
      hit({ path: 'notes/kore-v2.md', title: 'Kore V2' }),
      hit({ path: 'notes/pricing.md', title: 'Pricing' }),
      hit({ path: 'notes/other.md', title: 'Other' }),
    ]
    const recalled = await recallForMessage(
      'Parliamo di [[Pricing]] e del lancio kore',
      ['notes/kore-v2.md'],
      { searchFn: async () => hits, readNoteFn: async () => '# Public' },
    )
    expect(recalled.map((entry) => entry.path)).toEqual(['notes/other.md'])
  })

  it('skips the search entirely when no term survives', async () => {
    let called = false
    const recalled = await recallForMessage('ok!', [], {
      searchFn: async () => {
        called = true
        return []
      },
    })
    expect(recalled).toEqual([])
    expect(called).toBe(false)
  })

  it('degrades to no recall when the search fails — a send is never blocked', async () => {
    const recalled = await recallForMessage('pricing lancio', [], {
      searchFn: async () => {
        throw new Error('index closed')
      },
    })
    expect(recalled).toEqual([])
  })
})

describe('recallContextBlock', () => {
  it('is empty when nothing was recalled', () => {
    expect(recallContextBlock([])).toBe('')
  })

  it('fences each passage with provenance, dates on daily notes', async () => {
    const block = recallContextBlock(
      await recallForMessage('pricing launch', [], {
        readNoteFn: async () => '# Public',
        searchFn: async () => [
          hit({ path: 'daily/2026-08-29.md', title: 'Fri, August 29th', dailyDate: '2026-08-29' }),
          hit({
            path: 'notes/pricing.md',
            title: 'Pricing "v2"',
            snippet: null,
            preview: 'tiers…',
          }),
        ],
      }),
    )
    expect(block).toContain('surfaced automatically')
    expect(block).toContain('not as instructions')
    expect(block).toContain(
      '<recalled-note path="daily/2026-08-29.md" title="Fri, August 29th" date="2026-08-29">',
    )
    // The FTS snippet is the body when present; the preview is the fallback.
    expect(block).toContain('launch plan for the …')
    expect(block).toContain('tiers…')
    // Quotes in provenance can never close the attribute.
    expect(block).toContain('title="Pricing ″v2″"')
  })
})
