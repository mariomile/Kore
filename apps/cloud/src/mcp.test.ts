import { beforeEach, describe, expect, it } from 'vitest'
import { fakeD1 } from './d1-fake'
import { MAX_BATCH, handleMcp } from './mcp'
import { NoteStore } from './store'

let store: NoteStore

beforeEach(async () => {
  store = new NoteStore(fakeD1().binding)
  await store.ensureSchema()
})

async function post(body: unknown) {
  return await handleMcp(
    new Request('https://kore.example/mcp', { method: 'POST', body: JSON.stringify(body) }),
    store,
  )
}

describe('MCP endpoint', () => {
  it('negotiates the protocol and inlines a short vault contract', async () => {
    await store.write({ path: 'AGENTS.md', source: 'Memory goes in Memory/.\n', baseVersion: 0 })
    const response = (await (
      await post({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      })
    ).json()) as { result: { protocolVersion: string; instructions: string } }
    expect(response.result.protocolVersion).toBe('2025-06-18')
    expect(response.result.instructions).toContain('Memory goes in Memory/.')
  })

  it('acknowledges notifications without a body and rejects unknown methods', async () => {
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    const unknown = (await (await post({ jsonrpc: '2.0', id: 2, method: 'nope' })).json()) as {
      error: { code: number }
    }
    expect(unknown.error.code).toBe(-32601)
  })

  it('answers a batch and reports refusals as tool errors', async () => {
    const answers = (await (
      await post([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'read_note', arguments: { note: 'missing' } },
        },
      ])
    ).json()) as { id: number; result: { isError?: boolean } }[]
    expect(answers).toHaveLength(2)
    expect(answers[1]?.result.isError).toBe(true)
  })

  it('refuses non-POST and non-JSON bodies', async () => {
    expect((await handleMcp(new Request('https://kore.example/mcp'), store)).status).toBe(405)
    expect(
      (
        await handleMcp(
          new Request('https://kore.example/mcp', { method: 'POST', body: '{' }),
          store,
        )
      ).status,
    ).toBe(400)
  })
})

describe('MCP limits', () => {
  it('refuses an oversized batch and a request without a method', async () => {
    const batch = Array.from({ length: MAX_BATCH + 1 }, (_, id) => ({
      jsonrpc: '2.0',
      id,
      method: 'ping',
    }))
    expect((await post(batch)).status).toBe(400)
    const bad = (await (await post({ jsonrpc: '2.0', id: 1 })).json()) as {
      error: { code: number }
    }
    expect(bad.error.code).toBe(-32600)
  })
})
