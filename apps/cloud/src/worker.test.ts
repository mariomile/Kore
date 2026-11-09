import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { fakeD1 } from './d1-fake'
import { fakeKV } from './kv-fake'
import worker, { type Env } from './worker'

const ORIGIN = 'https://kore-cloud.example.workers.dev'
const KEY = 'test-access-key'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

// One database for the file: the Worker ensures its schema once per isolate.
const env = { DB: fakeD1().binding, OAUTH_KV: fakeKV(), KORE_ACCESS_KEY: KEY } as unknown as Env
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext

function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init) as never, env, ctx)
}

function rpc(body: unknown, token: string) {
  return fetchWorker('/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Kore Cloud Worker', () => {
  it('guards sync with the access key', async () => {
    expect((await fetchWorker('/sync/changes')).status).toBe(401)
    expect(
      (await fetchWorker('/sync/changes', { headers: { authorization: 'Bearer nope' } })).status,
    ).toBe(401)
    const ok = await fetchWorker('/sync/push', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        writes: [{ path: 'notes/pricing.md', source: '# Pricing\n\nseats\n', baseVersion: 0 }],
      }),
    })
    expect(ok.status).toBe(200)
  })

  it('answers MCP for the raw access key', async () => {
    const response = await rpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'seats' } },
      },
      KEY,
    )
    const body = (await response.json()) as { result: { content: { text: string }[] } }
    expect(JSON.parse(body.result.content[0]?.text ?? '') as unknown).toMatchObject({
      results: [{ path: 'notes/pricing.md' }],
    })
  })

  it('sends an unauthenticated agent to OAuth discovery', async () => {
    const response = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'not-a-token')
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata')
  })

  it('lets an agent sign in with the access key and then call tools', async () => {
    const registration = (await (
      await fetchWorker('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: [REDIRECT],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
        }),
      })
    ).json()) as { client_id: string }
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: registration.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      scope: 'mcp offline_access',
      resource: `${ORIGIN}/mcp`,
    })
    const page = await fetchWorker(`/authorize?${query}`)
    const html = await page.text()
    expect(html).toContain('Connect Claude to Kore')
    const cookie = page.headers.get('set-cookie')?.split(';')[0] ?? ''
    const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? ''
    const submit = (key: string) =>
      fetchWorker('/authorize', {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: new URLSearchParams({ handle, key, decision: 'approve' }),
      })
    expect((await submit('wrong')).status).toBe(401)
    const approved = await submit(KEY)
    expect(approved.status).toBe(302)
    const location = new URL(approved.headers.get('location') ?? '')
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT)
    const token = (await (
      await fetchWorker('/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: location.searchParams.get('code') ?? '',
          redirect_uri: REDIRECT,
          client_id: registration.client_id,
          code_verifier: verifier,
          resource: `${ORIGIN}/mcp`,
        }),
      })
    ).json()) as { access_token: string; refresh_token?: string }
    expect(token.refresh_token).toBeTruthy()
    const listed = (await (
      await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, token.access_token)
    ).json()) as {
      result: { tools: { name: string }[] }
    }
    expect(listed.result.tools.map((tool) => tool.name)).toContain('append_to_note')
  })
})
