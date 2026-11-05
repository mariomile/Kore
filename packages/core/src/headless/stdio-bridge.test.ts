import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createStdioBridge } from './stdio-bridge'

function connect(): {
  bridge: ReturnType<typeof createStdioBridge>
  requests: PassThrough
  replies: PassThrough
} {
  const requests = new PassThrough()
  const replies = new PassThrough()
  return { bridge: createStdioBridge(replies, requests), requests, replies }
}

describe('createStdioBridge', () => {
  it('writes one request line per call and resolves with its reply', async () => {
    const { bridge, requests, replies } = connect()
    const result = bridge.invoke('note_read', { path: 'notes/kore.md' })
    const line: unknown = JSON.parse(String(requests.read()))
    expect(line).toEqual({ id: 1, command: 'note_read', args: { path: 'notes/kore.md' } })
    replies.write(`${JSON.stringify({ id: 1, ok: '# Kore\n' })}\n`)
    await expect(result).resolves.toBe('# Kore\n')
    bridge.close()
  })

  it('rejects with the host error so call sites can branch on its kind', async () => {
    const { bridge, replies } = connect()
    const result = bridge.invoke('note_read', { path: 'notes/gone.md' })
    replies.write(
      `${JSON.stringify({ id: 1, error: { kind: 'notFound', message: 'no such note' } })}\n`,
    )
    await expect(result).rejects.toEqual({ kind: 'notFound', message: 'no such note' })
    bridge.close()
  })

  it('fails pending calls when the host sends a line that is not a reply', async () => {
    const { bridge, replies } = connect()
    const result = bridge.invoke('note_read', { path: 'notes/kore.md' })
    replies.write('not json\n')
    await expect(result).rejects.toEqual({
      kind: 'io',
      message: 'malformed reply from the indexer host',
    })
    bridge.close()
  })
})
