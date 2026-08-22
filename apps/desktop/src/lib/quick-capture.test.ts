import { describe, expect, it } from 'vitest'
import { buildGlobalShortcutEnvelope, foldQuickCaptureText } from './quick-capture'

describe('foldQuickCaptureText', () => {
  it('collapses newlines and trims', () => {
    expect(foldQuickCaptureText('  hello\nworld\r\n  ')).toBe('hello world')
  })

  it('returns empty for whitespace-only input', () => {
    expect(foldQuickCaptureText(' \n\t ')).toBe('')
  })
})

describe('buildGlobalShortcutEnvelope', () => {
  it('spools an append line tagged as the global shortcut', () => {
    const envelope = buildGlobalShortcutEnvelope('ship the release notes')
    expect(envelope).toMatchObject({
      version: 1,
      kind: 'append',
      text: 'ship the release notes',
      source: 'global-shortcut',
    })
    expect(envelope.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })
})
