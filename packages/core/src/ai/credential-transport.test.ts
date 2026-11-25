import { describe, expect, it } from 'vitest'
import { credentialTransportRefusal, PLAIN_HTTP_KEY_REFUSAL } from './credential-transport'

const withKey = new Headers({ Authorization: 'Bearer sk-test-123456' })

describe('credentialTransportRefusal', () => {
  it('refuses a key over plain http to a public host', () => {
    expect(credentialTransportRefusal('http://models.example.com/v1/chat', withKey)).toBe(
      PLAIN_HTTP_KEY_REFUSAL,
    )
    expect(
      credentialTransportRefusal('http://8.8.8.8/v1', new Headers({ 'x-api-key': 'secret' })),
    ).toBe(PLAIN_HTTP_KEY_REFUSAL)
  })

  it('lets https, the local network, and keyless requests through', () => {
    for (const url of [
      'https://api.openai.com/v1/models',
      'http://localhost:1234/v1',
      'http://127.0.0.1:11434/v1',
      'http://192.168.1.20:8080/v1',
      'http://10.0.0.5/v1',
      'http://172.20.1.1/v1',
      'http://mac-mini.local:1234/v1',
      'http://[::1]:1234/v1',
      'http://[fd00::12]/v1',
    ]) {
      expect(credentialTransportRefusal(url, withKey), url).toBeNull()
    }
    expect(credentialTransportRefusal('http://models.example.com/v1', new Headers())).toBeNull()
  })
})
