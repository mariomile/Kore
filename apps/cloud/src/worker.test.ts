import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { fakeD1 } from './d1-fake'
import { fakeKV } from './kv-fake'
import worker, { MAX_REGISTRATIONS_PER_DAY, WORKER_VERSION, type Env } from './worker'

const ORIGIN = 'https://kore-cloud.example.workers.dev'
const KEY = 'test-access-key'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

// One database for the file: the Worker ensures its schema once per isolate.
const env = { DB: fakeD1().binding, OAUTH_KV: fakeKV(), KORE_OWNER_KEY: KEY } as unknown as Env
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

let registered = 0

/** The whole OAuth sign-in an agent like Claude does; returns its access token. */
async function connectAgent(choice: { name: string; access: 'read' | 'write' }): Promise<string> {
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
  registered += 1
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
  expect(html).toContain('name="agent" value="Claude"')
  const cookie = page.headers.get('set-cookie')?.split(';')[0] ?? ''
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? ''
  const submit = async (key: string) =>
    await fetchWorker('/authorize', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({
        handle,
        key,
        agent: choice.name,
        access: choice.access,
        decision: 'approve',
      }),
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
  return token.access_token
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

  it('lets an agent sign in with the owner key, under a name, and signs its writes', async () => {
    const token = await connectAgent({ name: 'Claude phone', access: 'write' })
    const listed = (await (
      await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, token)
    ).json()) as { result: { tools: { name: string }[] } }
    expect(listed.result.tools.map((tool) => tool.name)).toContain('append_to_note')
    await rpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'append_to_note',
          arguments: { note: 'notes/pricing.md', markdown: 'from the phone' },
        },
      },
      token,
    )
    const feed = (await (
      await fetchWorker('/sync/changes?since=0', { headers: { authorization: `Bearer ${KEY}` } })
    ).json()) as { changes: { path: string; author: string | null }[] }
    expect(feed.changes.at(-1)).toMatchObject({ path: 'notes/pricing.md', author: 'Claude phone' })
  })

  it('keeps a read-only agent away from write tools', async () => {
    const token = await connectAgent({ name: 'Grok', access: 'read' })
    const listed = (await (
      await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, token)
    ).json()) as { result: { tools: { name: string }[] } }
    expect(listed.result.tools.map((tool) => tool.name)).not.toContain('append_to_note')
    const refused = (await (
      await rpc(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'append_to_note',
            arguments: { note: 'notes/pricing.md', markdown: 'x' },
          },
        },
        token,
      )
    ).json()) as { result: { isError?: boolean } }
    expect(refused.result.isError).toBe(true)
  })

  it('lists connected agents for the owner and disconnects one', async () => {
    const token = await connectAgent({ name: 'ChatGPT', access: 'write' })
    expect((await fetchWorker('/agents')).status).toBe(401)
    const owner = { authorization: `Bearer ${KEY}` }
    const listed = (await (await fetchWorker('/agents', { headers: owner })).json()) as {
      agents: { id: string; name: string; access: string }[]
    }
    const chatgpt = listed.agents.find((agent) => agent.name === 'ChatGPT')
    expect(chatgpt).toMatchObject({ access: 'write' })
    const revoked = await fetchWorker(`/agents/${encodeURIComponent(chatgpt?.id ?? '')}`, {
      method: 'DELETE',
      headers: owner,
    })
    expect(revoked.status).toBe(204)
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, token)).status).toBe(401)
  })

  it('reports its version publicly', async () => {
    const info = (await (await fetchWorker('/info')).json()) as { version: string }
    expect(info.version).toBe(WORKER_VERSION)
  })
})

describe('client registration', () => {
  const register = async (redirect: string) =>
    await fetchWorker('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'x',
        redirect_uris: [redirect],
        token_endpoint_auth_method: 'none',
      }),
    })

  it('refuses non-https redirects and caps registrations per day', async () => {
    expect((await register('http://evil.example/cb')).status).toBe(400)
    let accepted = registered // the sign-in tests above registered these today
    for (let attempt = 0; attempt < MAX_REGISTRATIONS_PER_DAY + 2; attempt += 1) {
      if ((await register(REDIRECT)).status < 300) {
        accepted += 1
      }
    }
    expect(accepted).toBe(MAX_REGISTRATIONS_PER_DAY)
  })
})
