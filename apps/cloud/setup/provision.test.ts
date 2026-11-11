import { describe, expect, it } from 'vitest'
import { Cloudflare, TOKEN_PERMISSIONS, tokenPageUrl, type Fetch } from './cloudflare'
import { provision, workerUpload } from './provision'

interface Call {
  method: string
  path: string
  body: unknown
}

/** A Cloudflare API stand-in: `routes` answers `METHOD path` with a result. */
function fakeCloudflare(routes: Record<string, unknown>): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetcher: Fetch = async (input, init) => {
    const path = input.replace('https://api.cloudflare.com/client/v4', '')
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
    calls.push({ method, path, body })
    const key = `${method} ${path}`
    if (!(key in routes)) {
      return new Response(
        JSON.stringify({ success: false, errors: [{ message: `no route ${key}` }] }),
        {
          status: 404,
        },
      )
    }
    return new Response(JSON.stringify({ success: true, errors: [], result: routes[key] }))
  }
  return { fetch: fetcher, calls }
}

const ACCOUNT = 'abcdef0123456789'

const fresh = {
  'GET /accounts?per_page=50': [{ id: ACCOUNT, name: 'Mario' }],
  [`GET /accounts/${ACCOUNT}/d1/database?name=kore`]: [],
  [`POST /accounts/${ACCOUNT}/d1/database`]: { uuid: 'db-1' },
  [`GET /accounts/${ACCOUNT}/storage/kv/namespaces?per_page=100`]: [],
  [`POST /accounts/${ACCOUNT}/storage/kv/namespaces`]: { id: 'kv-new' },
  [`GET /accounts/${ACCOUNT}/workers/scripts`]: [],
  [`PUT /accounts/${ACCOUNT}/workers/scripts/kore-cloud`]: {},
  [`PUT /accounts/${ACCOUNT}/workers/subdomain`]: { subdomain: 'kore-abcdef01' },
  [`POST /accounts/${ACCOUNT}/workers/scripts/kore-cloud/subdomain`]: {},
}

async function metadataOf(form: FormData): Promise<Record<string, unknown>> {
  const part = form.get('metadata') as Blob
  return JSON.parse(await part.text()) as Record<string, unknown>
}

describe('Kore Cloud setup', () => {
  it('prefills the token page with exactly the permissions setup needs', () => {
    const url = new URL(tokenPageUrl())
    expect(url.origin).toBe('https://dash.cloudflare.com')
    expect(url.searchParams.get('to')).toBe('/:account/api-tokens')
    expect(JSON.parse(url.searchParams.get('permissionGroupKeys') ?? '')).toEqual(TOKEN_PERMISSIONS)
    expect(url.searchParams.get('name')).toBe('Kore Cloud')
  })

  it('creates the database, storage and Worker on a fresh account', async () => {
    const { fetch, calls } = fakeCloudflare(fresh)
    const done = await provision(new Cloudflare('token', fetch), {
      bundle: 'export default {}',
      layout: '{}',
      ownerKey: 'owner-key',
      replaceKey: false,
    })
    expect(done).toEqual({
      accountId: ACCOUNT,
      workerName: 'kore-cloud',
      url: 'https://kore-cloud.kore-abcdef01.workers.dev',
      databaseId: 'db-1',
      created: true,
    })
    const namespaces = calls.filter(
      (call) => call.path.endsWith('/kv/namespaces') && call.method === 'POST',
    )
    expect(namespaces.map((call) => call.body)).toEqual([
      { title: 'kore-oauth' },
      { title: 'kore-pages' },
    ])
    const upload = calls.find(
      (call) => call.method === 'PUT' && call.path.endsWith('/scripts/kore-cloud'),
    )
    const metadata = await metadataOf(upload?.body as FormData)
    // A new Worker always gets the key, even without `replaceKey`.
    expect(metadata.bindings).toContainEqual({
      type: 'secret_text',
      name: 'KORE_OWNER_KEY',
      text: 'owner-key',
    })
    expect(metadata.keep_bindings).toBeUndefined()
  })

  it('updates an existing Worker in place and keeps its key', async () => {
    const { fetch, calls } = fakeCloudflare({
      ...fresh,
      [`GET /accounts/${ACCOUNT}/d1/database?name=kore`]: [{ uuid: 'db-old', name: 'kore' }],
      [`GET /accounts/${ACCOUNT}/storage/kv/namespaces?per_page=100`]: [
        { id: 'kv-oauth', title: 'kore-oauth' },
        { id: 'kv-pages', title: 'kore-pages' },
      ],
      [`GET /accounts/${ACCOUNT}/workers/scripts`]: [{ id: 'kore-cloud' }],
      [`GET /accounts/${ACCOUNT}/workers/subdomain`]: { subdomain: 'mario' },
    })
    const done = await provision(new Cloudflare('token', fetch), {
      bundle: 'export default {}',
      layout: '{}',
      ownerKey: 'owner-key',
      replaceKey: false,
    })
    expect(done.created).toBe(false)
    expect(done.databaseId).toBe('db-old')
    expect(done.url).toBe('https://kore-cloud.mario.workers.dev')
    expect(calls.some((call) => call.method === 'POST' && !call.path.endsWith('/subdomain'))).toBe(
      false,
    )
    const upload = calls.find(
      (call) => call.method === 'PUT' && call.path.endsWith('/scripts/kore-cloud'),
    )
    const metadata = await metadataOf(upload?.body as FormData)
    expect(metadata.keep_bindings).toEqual(['secret_text'])
    expect(JSON.stringify(metadata.bindings)).not.toContain('owner-key')
    expect(metadata.bindings).toContainEqual({
      type: 'kv_namespace',
      name: 'OAUTH_KV',
      namespace_id: 'kv-oauth',
    })
  })

  it('asks which account when the token reaches several', async () => {
    const { fetch } = fakeCloudflare({
      'GET /accounts?per_page=50': [
        { id: 'a', name: 'One' },
        { id: 'b', name: 'Two' },
      ],
    })
    await expect(
      provision(new Cloudflare('token', fetch), {
        bundle: '',
        layout: '{}',
        ownerKey: 'k',
        replaceKey: false,
      }),
    ).rejects.toThrow('Pass --account <id>')
  })

  it('reports Cloudflare errors with their message', async () => {
    const { fetch } = fakeCloudflare({})
    await expect(new Cloudflare('token', fetch).call('GET', '/nope')).rejects.toThrow(
      'GET /nope: no route GET /nope',
    )
  })

  it('uploads the Worker as an ES module with its bindings', async () => {
    const form = workerUpload({
      bundle: 'export default {}',
      databaseId: 'db',
      oauthNamespace: 'o',
      pagesNamespace: 'p',
      layout: '{"dailyFolder":"Daily"}',
      ownerKey: null,
    })
    const metadata = await metadataOf(form)
    expect(metadata.main_module).toBe('worker.js')
    expect(metadata.bindings).toContainEqual({ type: 'd1', name: 'DB', id: 'db' })
    expect(metadata.bindings).toContainEqual({
      type: 'plain_text',
      name: 'KORE_VAULT_LAYOUT',
      text: '{"dailyFolder":"Daily"}',
    })
    const script = form.get('worker.js') as Blob
    expect(script.type).toBe('application/javascript+module')
    expect(await script.text()).toBe('export default {}')
  })
})
