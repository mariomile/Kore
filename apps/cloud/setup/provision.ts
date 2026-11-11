import type { Cloudflare } from './cloudflare'

/**
 * Create (or find again) everything Kore Cloud needs in the user's own
 * Cloudflare account, then upload the Worker. Every step looks for what an
 * earlier run created first, so running setup again updates the Worker in
 * place and keeps the notes, the agents' grants and the owner key.
 */

export const DATABASE_NAME = 'kore'
export const OAUTH_NAMESPACE = 'kore-oauth'
export const PAGES_NAMESPACE = 'kore-pages'
export const DEFAULT_WORKER_NAME = 'kore-cloud'
export const COMPATIBILITY_DATE = '2026-10-01'
export const COMPATIBILITY_FLAGS = ['nodejs_compat', 'global_fetch_strictly_public'] as const

export interface ProvisionOptions {
  /** The account to use; required only when the token reaches several. */
  accountId?: string | undefined
  workerName?: string | undefined
  /** The bundled Worker module (`worker.js`). */
  bundle: string
  /** `VaultLayout` JSON for `KORE_VAULT_LAYOUT`. */
  layout: string
  /** The owner key: installed on a new Worker, and on an existing one when `replaceKey`. */
  ownerKey: string
  /** False keeps the key already on an existing Worker. */
  replaceKey: boolean
  /** Progress lines for the person running setup. */
  log?: (line: string) => void
}

export interface Provisioned {
  accountId: string
  workerName: string
  url: string
  databaseId: string
  /** True when the Worker did not exist before this run. */
  created: boolean
}

interface Account {
  id: string
  name: string
}

/** The one account the token reaches, or the one asked for. */
export async function pickAccount(cf: Cloudflare, accountId?: string): Promise<Account> {
  const accounts = await cf.call<Account[]>('GET', '/accounts?per_page=50')
  if (accountId !== undefined) {
    const chosen = accounts.find((account) => account.id === accountId)
    if (chosen === undefined) {
      throw new Error(`The token cannot reach account ${accountId}.`)
    }
    return chosen
  }
  const [only, ...others] = accounts
  if (only === undefined) {
    throw new Error(
      'The token reaches no Cloudflare account. Create it from the account you want to use.',
    )
  }
  if (others.length > 0) {
    throw new Error(
      `The token reaches ${accounts.length} accounts (${accounts.map((account) => `${account.name}: ${account.id}`).join(', ')}). Pass --account <id>.`,
    )
  }
  return only
}

async function ensureDatabase(cf: Cloudflare, account: string): Promise<string> {
  const found = await cf.call<{ uuid: string; name: string }[]>(
    'GET',
    `/accounts/${account}/d1/database?name=${DATABASE_NAME}`,
  )
  const existing = found.find((database) => database.name === DATABASE_NAME)
  if (existing !== undefined) {
    return existing.uuid
  }
  const created = await cf.call<{ uuid: string }>('POST', `/accounts/${account}/d1/database`, {
    name: DATABASE_NAME,
  })
  return created.uuid
}

async function ensureNamespace(cf: Cloudflare, account: string, title: string): Promise<string> {
  const found = await cf.call<{ id: string; title: string }[]>(
    'GET',
    `/accounts/${account}/storage/kv/namespaces?per_page=100`,
  )
  const existing = found.find((namespace) => namespace.title === title)
  if (existing !== undefined) {
    return existing.id
  }
  const created = await cf.call<{ id: string }>(
    'POST',
    `/accounts/${account}/storage/kv/namespaces`,
    {
      title,
    },
  )
  return created.id
}

async function workerExists(cf: Cloudflare, account: string, name: string): Promise<boolean> {
  const scripts = await cf.call<{ id: string }[]>('GET', `/accounts/${account}/workers/scripts`)
  return scripts.some((script) => script.id === name)
}

/** The account's `*.workers.dev` subdomain, registering one on a fresh account. */
async function ensureSubdomain(cf: Cloudflare, account: string, fallback: string): Promise<string> {
  try {
    const { subdomain } = await cf.call<{ subdomain: string }>(
      'GET',
      `/accounts/${account}/workers/subdomain`,
    )
    if (subdomain !== '') {
      return subdomain
    }
  } catch {
    // A fresh account has no subdomain yet: register one below.
  }
  const { subdomain } = await cf.call<{ subdomain: string }>(
    'PUT',
    `/accounts/${account}/workers/subdomain`,
    {
      subdomain: fallback,
    },
  )
  return subdomain
}

/** The multipart body of a module Worker upload. */
export function workerUpload(options: {
  bundle: string
  databaseId: string
  oauthNamespace: string
  pagesNamespace: string
  layout: string
  ownerKey: string | null
}): FormData {
  const bindings: Record<string, string>[] = [
    { type: 'd1', name: 'DB', id: options.databaseId },
    { type: 'kv_namespace', name: 'OAUTH_KV', namespace_id: options.oauthNamespace },
    { type: 'kv_namespace', name: 'PAGES', namespace_id: options.pagesNamespace },
    { type: 'plain_text', name: 'KORE_VAULT_LAYOUT', text: options.layout },
  ]
  if (options.ownerKey !== null) {
    bindings.push({ type: 'secret_text', name: 'KORE_OWNER_KEY', text: options.ownerKey })
  }
  const metadata = {
    main_module: 'worker.js',
    compatibility_date: COMPATIBILITY_DATE,
    compatibility_flags: COMPATIBILITY_FLAGS,
    bindings,
    // Without a new key, the secret already on the Worker stays as it is.
    ...(options.ownerKey === null ? { keep_bindings: ['secret_text'] } : {}),
  }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append(
    'worker.js',
    new Blob([options.bundle], { type: 'application/javascript+module' }),
    'worker.js',
  )
  return form
}

export async function provision(cf: Cloudflare, options: ProvisionOptions): Promise<Provisioned> {
  const log = options.log ?? (() => {})
  const workerName = options.workerName ?? DEFAULT_WORKER_NAME
  const account = await pickAccount(cf, options.accountId)
  log(`Cloudflare account: ${account.name}`)
  const databaseId = await ensureDatabase(cf, account.id)
  log('Database ready')
  const oauthNamespace = await ensureNamespace(cf, account.id, OAUTH_NAMESPACE)
  const pagesNamespace = await ensureNamespace(cf, account.id, PAGES_NAMESPACE)
  log('Storage ready')
  const created = !(await workerExists(cf, account.id, workerName))
  await cf.call(
    'PUT',
    `/accounts/${account.id}/workers/scripts/${workerName}`,
    workerUpload({
      bundle: options.bundle,
      databaseId,
      oauthNamespace,
      pagesNamespace,
      layout: options.layout,
      ownerKey: created || options.replaceKey ? options.ownerKey : null,
    }),
  )
  log(created ? 'Worker uploaded' : 'Worker updated')
  const subdomain = await ensureSubdomain(cf, account.id, `kore-${account.id.slice(0, 8)}`)
  await cf.call('POST', `/accounts/${account.id}/workers/scripts/${workerName}/subdomain`, {
    enabled: true,
    previews_enabled: false,
  })
  return {
    accountId: account.id,
    workerName,
    url: `https://${workerName}.${subdomain}.workers.dev`,
    databaseId,
    created,
  }
}
