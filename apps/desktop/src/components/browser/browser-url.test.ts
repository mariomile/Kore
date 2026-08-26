import { describe, expect, it } from 'vitest'
import { urlForInput } from './browser-url'

describe('urlForInput', () => {
  it('returns null for blank input', () => {
    expect(urlForInput('')).toBeNull()
    expect(urlForInput('   ')).toBeNull()
  })

  it('keeps an explicit http(s) URL', () => {
    expect(urlForInput('https://example.com/docs')).toBe('https://example.com/docs')
    expect(urlForInput('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('prefixes a bare host with https', () => {
    expect(urlForInput('duckduckgo.com')).toBe('https://duckduckgo.com')
    expect(urlForInput('example.com/path?q=1')).toBe('https://example.com/path?q=1')
  })

  it('treats free text as a DuckDuckGo query by default', () => {
    expect(urlForInput('how to wiki link')).toBe('https://duckduckgo.com/?q=how%20to%20wiki%20link')
  })

  it('uses the chosen search engine for free text', () => {
    expect(urlForInput('how to wiki link', 'google')).toBe(
      'https://www.google.com/search?q=how%20to%20wiki%20link',
    )
    expect(urlForInput('how to wiki link', 'bing')).toBe(
      'https://www.bing.com/search?q=how%20to%20wiki%20link',
    )
  })
})
