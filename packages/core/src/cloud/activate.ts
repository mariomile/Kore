import type { VaultLayout } from '../graph/vault-layout'
import { KoreCloud } from './client'
import { Cloudflare, type Fetch } from './cloudflare'
import { DEFAULT_WORKER_NAME, provision } from './provision'
import { uploadNotes, type LocalNote, type UploadReport } from './upload'

/**
 * Turning Kore Cloud on (Plan 34), the one sequence both the app's Settings
 * and `kore cloud setup` run: create or find everything in the user's own
 * Cloudflare account, upload the Worker, wait for it to answer, and send the
 * notes it lacks. The host brings the transport, the Worker bundle, the
 * vault's notes and somewhere to keep the result; nothing here touches disk.
 */

/** What a host keeps to reach its Kore Cloud again. `ownerKey` is a secret. */
export interface KoreCloudConfig {
  url: string
  ownerKey: string
  accountId: string
  workerName: string
}

export interface ActivateOptions {
  /** The user's Cloudflare API token, used for this run only. */
  token: string
  fetch: Fetch
  /** The bundled Worker module. */
  bundle: string
  layout: VaultLayout
  /** The config of an earlier run, so the owner key and Worker stay the same. */
  saved: KoreCloudConfig | null
  accountId?: string | undefined
  workerName?: string | undefined
  /** The vault's notes, read once the Worker is up. */
  readNotes: () => Promise<LocalNote[]>
  /** Called once the Worker exists, before the upload, so the key is kept even if the upload fails. */
  onConfig?: (config: KoreCloudConfig) => Promise<void>
  /** A line of progress for the person waiting. */
  onStep?: (line: string) => void
  /** Notes sent so far out of those to send. */
  onUpload?: (sent: number, total: number) => void
  /** Pause between checks while the new Worker starts (tests pass 0). */
  pollMs?: number
}

export interface Activated {
  config: KoreCloudConfig
  /** True when the Worker did not exist before. */
  created: boolean
  report: UploadReport
}

/** A new owner key: 32 random bytes, base64url. */
export function newOwnerKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** The address an agent adds as a custom connector. */
export function connectorUrl(config: Pick<KoreCloudConfig, 'url'>): string {
  return `${config.url.replace(/\/+$/, '')}/mcp`
}

/** Wait until a new Worker answers `/info` (about a minute at most). */
export async function waitForWorker(cloud: KoreCloud, pollMs = 2000): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await cloud.info()) !== null) {
      return
    }
    await new Promise((done) => setTimeout(done, pollMs))
  }
  throw new Error('Kore Cloud did not answer within a minute. Try again in a moment.')
}

export async function activateKoreCloud(options: ActivateOptions): Promise<Activated> {
  const step = options.onStep ?? (() => {})
  const token = options.token.trim()
  if (token === '') {
    throw new Error('Paste the token Cloudflare showed you.')
  }
  const { saved } = options
  const workerName = options.workerName ?? saved?.workerName ?? DEFAULT_WORKER_NAME
  const keep =
    saved !== null &&
    saved.workerName === workerName &&
    (options.accountId === undefined || options.accountId === saved.accountId)
  const ownerKey = keep ? saved.ownerKey : newOwnerKey()
  const done = await provision(new Cloudflare(token, options.fetch), {
    accountId: options.accountId ?? (keep ? saved.accountId : undefined),
    workerName,
    bundle: options.bundle,
    layout: JSON.stringify(options.layout),
    ownerKey,
    // A saved key for this Worker stays; otherwise the new one is installed.
    replaceKey: !keep,
    log: step,
  })
  const config: KoreCloudConfig = {
    url: done.url,
    ownerKey,
    accountId: done.accountId,
    workerName,
  }
  await options.onConfig?.(config)
  const cloud = new KoreCloud(config.url, ownerKey, options.fetch)
  step('Waiting for Kore Cloud to start')
  await waitForWorker(cloud, options.pollMs)
  step('Reading your notes')
  const notes = await options.readNotes()
  step('Uploading notes')
  const report = await uploadNotes(cloud, notes, options.onUpload)
  return { config, created: done.created, report }
}
