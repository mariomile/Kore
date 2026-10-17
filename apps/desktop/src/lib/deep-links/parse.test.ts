import { describe, expect, it } from 'vitest'
import { DEEP_LINK_TEXT_MAX_LENGTH } from '@/lib/deep-links/deep-link'
import { isDeepLinkUrl, parseDeepLink } from '@/lib/deep-links/parse'

describe('parseDeepLink', () => {
  it('parses the bare navigation verbs', () => {
    expect(parseDeepLink('kore://today')).toEqual({
      kind: 'navigate',
      route: { kind: 'today' },
    })
    expect(parseDeepLink('kore://tasks')).toEqual({
      kind: 'navigate',
      route: { kind: 'tasks' },
    })
  })

  it('tolerates a trailing slash and the host lower-casing of the parser', () => {
    expect(parseDeepLink('kore://today/')).toEqual({
      kind: 'navigate',
      route: { kind: 'today' },
    })
    expect(parseDeepLink('kore://Today')).toEqual({
      kind: 'navigate',
      route: { kind: 'today' },
    })
  })

  it('rejects stray path segments on bare verbs', () => {
    expect(parseDeepLink('kore://today/extra')).toBeNull()
    expect(parseDeepLink('kore://tasks/2026')).toBeNull()
  })

  it('parses calendar-valid daily dates and rejects impossible ones', () => {
    expect(parseDeepLink('kore://daily/2026-07-01')).toEqual({
      kind: 'navigate',
      route: { kind: 'daily', date: '2026-07-01' },
    })
    expect(parseDeepLink('kore://daily/2026-02-31')).toBeNull()
    expect(parseDeepLink('kore://daily/not-a-date')).toBeNull()
    expect(parseDeepLink('kore://daily')).toBeNull()
  })

  it('parses search queries, including an empty one', () => {
    expect(parseDeepLink('kore://search?q=meeting%20notes')).toEqual({
      kind: 'navigate',
      route: { kind: 'search', query: 'meeting notes' },
    })
    expect(parseDeepLink('kore://search?q=')).toEqual({
      kind: 'navigate',
      route: { kind: 'search', query: '' },
    })
    expect(parseDeepLink('kore://search')).toBeNull()
  })

  it('parses note targets in encoded, raw-slash, and id forms', () => {
    expect(parseDeepLink('kore://note/Project%20X')).toEqual({
      kind: 'openNote',
      target: 'Project X',
    })
    expect(parseDeepLink('kore://note/notes/foo.md')).toEqual({
      kind: 'openNote',
      target: 'notes/foo.md',
    })
    expect(parseDeepLink('kore://note/notes%2Ffoo.md')).toEqual({
      kind: 'openNote',
      target: 'notes/foo.md',
    })
    expect(parseDeepLink('kore://note/x7Kp2q')).toEqual({
      kind: 'openNote',
      target: 'x7Kp2q',
    })
  })

  it('rejects an empty note target and malformed percent-encoding', () => {
    expect(parseDeepLink('kore://note')).toBeNull()
    expect(parseDeepLink('kore://note/')).toBeNull()
    expect(parseDeepLink('kore://note/%E0%A4%A')).toBeNull()
  })

  it('parses write links into capture payloads', () => {
    expect(parseDeepLink('kore://append?text=hello%20world')).toEqual({
      kind: 'capture',
      capture: 'append',
      text: 'hello world',
    })
    expect(parseDeepLink('kore://checkbox?text=pack+a+bag')).toEqual({
      kind: 'capture',
      capture: 'checkbox',
      text: 'pack a bag',
    })
    expect(parseDeepLink('kore://task?text=Buy+milk')).toEqual({
      kind: 'capture',
      capture: 'task',
      text: 'Buy milk',
    })
  })

  it('folds capture text to a single trimmed line', () => {
    expect(parseDeepLink('kore://append?text=%20line%20one%0A%0A%23%20line%20two%20')).toEqual({
      kind: 'capture',
      capture: 'append',
      text: 'line one # line two',
    })
  })

  it('rejects empty, whitespace-only, and over-long capture text', () => {
    expect(parseDeepLink('kore://append')).toBeNull()
    expect(parseDeepLink('kore://append?text=')).toBeNull()
    expect(parseDeepLink('kore://append?text=%20%0A%20')).toBeNull()
    const oversized = 'a'.repeat(DEEP_LINK_TEXT_MAX_LENGTH + 1)
    expect(parseDeepLink(`kore://append?text=${oversized}`)).toBeNull()
  })

  it('rejects write links carrying a path segment', () => {
    expect(parseDeepLink('kore://append/extra?text=hi')).toBeNull()
  })

  it('still reads links written with the legacy reflect scheme', () => {
    expect(parseDeepLink('reflect://today')).toEqual({
      kind: 'navigate',
      route: { kind: 'today' },
    })
    expect(parseDeepLink('reflect://note/01hzy3v9k2m4n6p8q0r2s4t6vw')).toEqual({
      kind: 'openNote',
      target: '01hzy3v9k2m4n6p8q0r2s4t6vw',
    })
  })

  it('rejects other schemes, unknown verbs, and non-URLs', () => {
    expect(parseDeepLink('https://today')).toBeNull()
    expect(parseDeepLink('kore://settings')).toBeNull()
    expect(parseDeepLink('kore://edit-notes?content=evil')).toBeNull()
    expect(parseDeepLink('not a url')).toBeNull()
    expect(parseDeepLink('')).toBeNull()
  })
})

describe('isDeepLinkUrl', () => {
  it('matches the kore scheme and the legacy reflect one, regardless of case', () => {
    expect(isDeepLinkUrl('kore://today')).toBe(true)
    expect(isDeepLinkUrl('KORE://note/abc')).toBe(true)
    expect(isDeepLinkUrl('reflect://today')).toBe(true)
    expect(isDeepLinkUrl('REFLECT://note/abc')).toBe(true)
  })

  it('matches scheme-only, even links the parser would reject', () => {
    expect(isDeepLinkUrl('kore://settings')).toBe(true)
    expect(isDeepLinkUrl('kore:today')).toBe(true)
  })

  it('rejects other schemes and non-URLs', () => {
    expect(isDeepLinkUrl('https://example.com')).toBe(false)
    expect(isDeepLinkUrl('mailto:someone@example.com')).toBe(false)
    expect(isDeepLinkUrl('assets/cat.png')).toBe(false)
    expect(isDeepLinkUrl('not a url')).toBe(false)
    expect(isDeepLinkUrl('')).toBe(false)
  })
})
