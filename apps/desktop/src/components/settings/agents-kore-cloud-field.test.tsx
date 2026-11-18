import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { setBridge } from '@kore/core'
import { AgentsKoreCloudField, uploadSummary } from './agents-kore-cloud-field'

const opened: string[] = []
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: async (url: string) => {
    opened.push(url)
  },
}))
vi.mock('@/lib/kore-cloud-bundle', () => ({
  loadKoreCloudWorker: async () => 'export default {}',
}))

const ACCOUNT = 'abcdef0123456789'
const WORKER = 'https://kore-cloud.mario.workers.dev'

let secrets: Map<string, string>
let pushed: string[]
let agents: { id: string; name: string; access: 'read' | 'write'; createdAt: string }[]
let tokenSeen: string | null

const vaultNotes: Record<string, string> = {
  'Kore.md': '# Kore\n\nAlways on',
  'Secret.md': '---\nprivate: true\n---\n# Secret',
}

/** Cloudflare's API and the new Worker, as the field reaches them. */
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  const method = init?.method ?? 'GET'
  const envelope = (result: unknown) => Response.json({ success: true, errors: [], result })
  if (url.hostname === 'api.cloudflare.com') {
    tokenSeen = new Headers(init?.headers).get('authorization')
    const path = url.pathname.replace('/client/v4', '') + url.search
    switch (`${method} ${path}`) {
      case 'GET /accounts?per_page=50':
        return envelope([{ id: ACCOUNT, name: 'Mario' }])
      case `GET /accounts/${ACCOUNT}/d1/database?name=kore`:
      case `GET /accounts/${ACCOUNT}/storage/kv/namespaces?per_page=100`:
      case `GET /accounts/${ACCOUNT}/workers/scripts`:
        return envelope([])
      case `POST /accounts/${ACCOUNT}/d1/database`:
        return envelope({ uuid: 'db' })
      case `POST /accounts/${ACCOUNT}/storage/kv/namespaces`:
        return envelope({ id: 'kv' })
      case `GET /accounts/${ACCOUNT}/workers/subdomain`:
        return envelope({ subdomain: 'mario' })
      default:
        return envelope({})
    }
  }
  if (url.pathname === '/info') {
    return Response.json({ name: 'kore-cloud', version: '0.2.0', pages: true })
  }
  if (url.pathname === '/sync/changes') {
    return Response.json({ changes: [], cursor: 0, more: false })
  }
  if (url.pathname === '/sync/push') {
    const { writes } = JSON.parse(String(init?.body)) as { writes: { path: string }[] }
    pushed.push(...writes.map((write) => write.path))
    return Response.json({
      results: writes.map((write) => ({ path: write.path, status: 'ok', version: 1, seq: 1 })),
    })
  }
  if (url.pathname === '/agents') {
    return Response.json({ agents })
  }
  if (url.pathname.startsWith('/agents/') && method === 'DELETE') {
    agents = agents.filter((agent) => `/agents/${agent.id}` !== url.pathname)
    return new Response(null, { status: 204 })
  }
  return new Response('not found', { status: 404 })
}

vi.mock('@/lib/provider-fetch', () => ({ providerFetch: fakeFetch }))

beforeEach(() => {
  opened.length = 0
  secrets = new Map()
  pushed = []
  agents = []
  tokenSeen = null
  setBridge({
    invoke: async (command, args) => {
      const name = (args as { name?: string } | undefined)?.name ?? ''
      switch (command) {
        case 'secret_get':
          return secrets.get(name) ?? null
        case 'secret_set':
          secrets.set(name, (args as { value: string }).value)
          return null
        case 'secret_delete':
          secrets.delete(name)
          return null
        case 'list_files':
          return Object.keys(vaultNotes).map((path) => ({ path, size: 10, modifiedMs: 0 }))
        case 'note_read':
          return vaultNotes[(args as { path: string }).path]
        default:
          throw new Error(`unexpected command ${command}`)
      }
    },
    listen: async () => () => {},
  })
})

afterEach(() => {
  setBridge(null)
})

async function renderField(): Promise<void> {
  await render(
    <AgentsKoreCloudField graphName="marioverse" graphRoot="/vaults/marioverse" generation={1} />,
  )
}

describe('AgentsKoreCloudField', () => {
  it('sets Kore Cloud up from one button and a pasted token', async () => {
    await renderField()
    await page.getByRole('button', { name: 'Set up Kore Cloud' }).click()
    // The token page opens with the permissions filled in.
    expect(opened[0]).toContain('dash.cloudflare.com')
    expect(opened[0]).toContain('permissionGroupKeys')

    await page.getByLabelText('Cloudflare API token').fill('  cf-token  ')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect.element(page.getByText(`${WORKER}/mcp`)).toBeVisible()
    await expect
      .element(page.getByText('1 note uploaded, 1 private stayed on this Mac.'))
      .toBeVisible()
    expect(tokenSeen).toBe('Bearer cf-token')
    // The private note never left.
    expect(pushed).toEqual(['Kore.md'])
    // The address and owner key are kept in the keychain, never the token.
    const stored = JSON.parse(secrets.get('kore-cloud') ?? '{}') as Record<string, string>
    expect(stored.url).toBe(WORKER)
    expect(stored.vaultRoot).toBe('/vaults/marioverse')
    expect(stored.ownerKey?.length).toBeGreaterThan(30)
    expect(JSON.stringify(stored)).not.toContain('cf-token')
  })

  it('lists connected agents and disconnects one', async () => {
    secrets.set(
      'kore-cloud',
      JSON.stringify({
        url: WORKER,
        ownerKey: 'owner-key-owner-key-owner-key-1',
        accountId: ACCOUNT,
        workerName: 'kore-cloud',
        vaultRoot: '/vaults/marioverse',
      }),
    )
    agents = [
      { id: 'g1', name: 'Claude phone', access: 'write', createdAt: '2026-11-16T00:00:00Z' },
    ]
    await renderField()
    await expect.element(page.getByText('Claude phone')).toBeVisible()
    await page.getByRole('button', { name: 'Disconnect Claude phone' }).click()
    await expect.element(page.getByText('None yet.')).toBeVisible()
  })

  it('says when Kore Cloud serves another vault', async () => {
    secrets.set(
      'kore-cloud',
      JSON.stringify({
        url: WORKER,
        ownerKey: 'owner-key-owner-key-owner-key-1',
        accountId: ACCOUNT,
        workerName: 'kore-cloud',
        vaultRoot: '/vaults/other',
      }),
    )
    await renderField()
    await expect.element(page.getByText(/serves another vault/)).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Set up Kore Cloud' })).toBeVisible()
  })
})

describe('uploadSummary', () => {
  it('reads as one sentence', () => {
    expect(
      uploadSummary({
        uploaded: 5102,
        unchanged: 0,
        differs: [],
        private: 3,
        tooLarge: [],
        failed: [],
      }),
    ).toBe('5,102 notes uploaded, 3 private stayed on this Mac.')
  })
})
