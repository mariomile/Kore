import { describe, expect, it } from 'vitest'
import { listHostedModels } from './hosted-models'

function fetchJson(body: unknown): typeof fetch {
  return async () => Response.json(body)
}

const SECONDS = (iso: string) => Date.parse(iso) / 1000

describe('listHostedModels', () => {
  it('adds models launched after the catalog, newest first, and keeps the catalog it can call', async () => {
    const models = await listHostedModels(
      { provider: 'openai', apiKey: 'sk-test' },
      fetchJson({
        data: [
          { id: 'gpt-6.2-astra', created: SECONDS('2026-11-17T00:00:00Z') },
          { id: 'gpt-6.2-sol', created: SECONDS('2026-11-17T00:00:00Z') },
          // Older than every catalog model the key lists: not news.
          { id: 'gpt-4o', created: SECONDS('2024-05-13T00:00:00Z') },
          // A snapshot and a non-chat model.
          { id: 'gpt-6.2-sol-2026-11-17', created: SECONDS('2026-11-18T00:00:00Z') },
          { id: 'gpt-6.3-realtime', created: SECONDS('2026-12-02T00:00:00Z') },
          { id: 'gpt-6.3-sol', created: SECONDS('2026-12-01T00:00:00Z') },
          { id: 'gpt-7-astra', created: SECONDS('2027-02-01T00:00:00Z') },
        ],
      }),
    )
    expect(models?.map((model) => model.id)).toEqual([
      'gpt-7-astra',
      'gpt-6.3-sol',
      'gpt-6.2-astra',
      'gpt-6.2-sol',
    ])
    expect(models?.[2]?.label).toBe('GPT-6.2 Astra')
  })

  it('offers everything a compatible server lists, in its order', async () => {
    const calls: string[] = []
    const models = await listHostedModels(
      { provider: 'openai-compatible', apiKey: '', baseUrl: 'http://localhost:11434/v1/' },
      async (input) => {
        calls.push(String(input))
        return Response.json({ data: [{ id: 'qwen4:32b' }, { id: 'llama5:8b' }] })
      },
    )
    expect(calls).toEqual(['http://localhost:11434/v1/models'])
    expect(models?.map((model) => model.id)).toEqual(['qwen4:32b', 'llama5:8b'])
  })

  it('keeps the catalog when the list cannot be read', async () => {
    const failing: typeof fetch = async () => new Response(null, { status: 500 })
    expect(await listHostedModels({ provider: 'anthropic', apiKey: 'k' }, failing)).toBeNull()
    expect(await listHostedModels({ provider: 'openrouter', apiKey: 'k' }, failing)).toBeNull()
  })
})
