import { describe, expect, it } from 'vitest'
import { tagSchemaAiPrompt } from './schema-ai-prompt'

describe('tagSchemaAiPrompt', () => {
  it('names the tag by its full key so the chat reads the right notes', () => {
    expect(tagSchemaAiPrompt('type/course')).toContain('#type/course ')
  })

  it('asks for a proposal, not a write', () => {
    expect(tagSchemaAiPrompt('book')).toContain('before changing anything')
  })
})
