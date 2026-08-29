import { describe, expect, it } from 'vitest'
import { shortModelLabel } from './chat-model-groups'

describe('shortModelLabel', () => {
  it('drops a provider prefix separated by a middot', () => {
    expect(shortModelLabel('Anthropic · Claude Sonnet 4.5')).toBe('Claude Sonnet 4.5')
  })

  it('drops a slug namespace', () => {
    expect(shortModelLabel('openai/gpt-5')).toBe('gpt-5')
    expect(shortModelLabel('anthropic/claude-opus-4.5')).toBe('claude-opus-4.5')
  })

  it('leaves a bare model name alone', () => {
    expect(shortModelLabel('Claude Sonnet 4.5')).toBe('Claude Sonnet 4.5')
  })

  it('falls back to the label when stripping would empty it', () => {
    expect(shortModelLabel('gpt-5/')).toBe('gpt-5/')
    expect(shortModelLabel('Anthropic · ')).toBe('Anthropic · ')
  })
})
