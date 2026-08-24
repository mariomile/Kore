import { describe, expect, it } from 'vitest'
import { formatCalloutBlock, parseCalloutMarker } from './callout'

describe('parseCalloutMarker', () => {
  it('reads a GitHub alert kind, case-insensitively', () => {
    expect(parseCalloutMarker('[!NOTE]')).toEqual({ kind: 'note', title: null })
    expect(parseCalloutMarker('[!Warning]')).toEqual({ kind: 'warning', title: null })
    expect(parseCalloutMarker('  [!caution]  ')).toEqual({ kind: 'caution', title: null })
  })

  it('maps [!info] onto note', () => {
    expect(parseCalloutMarker('[!INFO]')).toEqual({ kind: 'note', title: null })
  })

  it('captures an optional title', () => {
    expect(parseCalloutMarker('[!TIP] Shipping notes')).toEqual({
      kind: 'tip',
      title: 'Shipping notes',
    })
  })

  it('rejects ordinary quoted prose', () => {
    expect(parseCalloutMarker('a quote')).toBeNull()
    expect(parseCalloutMarker('[note]')).toBeNull()
    expect(parseCalloutMarker('[!unknown]')).toBeNull()
  })
})

describe('formatCalloutBlock', () => {
  it('inserts a typed empty alert the parser accepts', () => {
    const markdown = formatCalloutBlock('important')
    expect(markdown).toBe('> [!IMPORTANT]\n> \n')
    expect(parseCalloutMarker(markdown.split('\n')[0]!.replace(/^>\s?/, ''))).toEqual({
      kind: 'important',
      title: null,
    })
  })
})
