import { describe, expect, it } from 'vitest'
import { REDACTED, redactSecrets } from './redact-secrets'

describe('redactSecrets', () => {
  it('scrubs key-shaped tokens, auth headers and known keys', () => {
    expect(redactSecrets('Incorrect API key provided: sk-proj-****abcd.')).toBe(
      `Incorrect API key provided: ${REDACTED}.`,
    )
    expect(redactSecrets('bad key AIzaSyA1234567890abcdefghijklmn')).toBe(`bad key ${REDACTED}`)
    expect(redactSecrets('sent Authorization: Bearer abc.def.ghi-123')).toBe(
      `sent Authorization: Bearer ${REDACTED}`,
    )
    expect(redactSecrets('rejected key lm-studio-key-42', ['lm-studio-key-42'])).toBe(
      `rejected key ${REDACTED}`,
    )
  })

  it('leaves ordinary error text alone', () => {
    const text = 'Rate limit reached for gpt-5 on the task-force project. Retry in 20s.'
    expect(redactSecrets(text)).toBe(text)
  })
})
