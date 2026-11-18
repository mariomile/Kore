import { z } from 'zod'
import { listFiles, readNote } from '../graph/commands'
import { getVaultLayout } from '../graph/vault-layout'
import { deleteSecret, getJsonSecret, setJsonSecret } from '../secrets/keychain'
import { activateKoreCloud, waitForWorker, type Activated } from './activate'
import { KoreCloud } from './client'
import type { Fetch } from './cloudflare'
import { isNotePath } from './note-rules'
import { uploadNotes, type LocalNote, type UploadReport } from './upload'

/**
 * The app's side of Kore Cloud (Plan 34): Settings → Agents turns it on for
 * the open vault. The Worker's URL and the owner key are kept together in
 * the OS keychain (the key is a secret, and the URL means nothing without
 * it), with the vault they belong to, so another vault opened later is told
 * Kore Cloud serves a different one.
 */

/** Keychain entry holding {@link StoredKoreCloud} as JSON. */
export const KORE_CLOUD_SECRET = 'kore-cloud'

const storedSchema = z.object({
  url: z.string().url(),
  ownerKey: z.string().min(1),
  accountId: z.string(),
  workerName: z.string(),
  /** The vault root this Kore Cloud serves. */
  vaultRoot: z.string(),
})

export type StoredKoreCloud = z.infer<typeof storedSchema>

/** The Kore Cloud this app turned on, or null. */
export async function loadKoreCloud(): Promise<StoredKoreCloud | null> {
  return await getJsonSecret(KORE_CLOUD_SECRET, storedSchema)
}

/** Forget Kore Cloud on this Mac. The Worker and its notes stay in Cloudflare. */
export async function forgetKoreCloud(): Promise<void> {
  await deleteSecret(KORE_CLOUD_SECRET)
}

/** Every note of the open vault that may go to Kore Cloud, read from disk. */
async function readVaultNotes(generation: number): Promise<LocalNote[]> {
  const files = (await listFiles(generation)).filter(
    (file) => file.placeholder !== true && isNotePath(file.path),
  )
  const notes: LocalNote[] = []
  for (const file of files) {
    notes.push({ path: file.path, source: await readNote(file.path, generation) })
  }
  return notes
}

export interface ActivateForVaultOptions {
  token: string
  fetch: Fetch
  /** The bundled Worker module (the app loads it on demand). */
  bundle: string
  vaultRoot: string
  generation: number
  onStep?: (line: string) => void
  onUpload?: (sent: number, total: number) => void
}

/**
 * Turn Kore Cloud on for the open vault, or update it in place when this app
 * already turned it on for the same vault (same Worker, same owner key).
 */
export async function activateKoreCloudForVault(
  options: ActivateForVaultOptions,
): Promise<Activated> {
  const stored = await loadKoreCloud()
  const saved = stored !== null && stored.vaultRoot === options.vaultRoot ? stored : null
  return await activateKoreCloud({
    token: options.token,
    fetch: options.fetch,
    bundle: options.bundle,
    layout: getVaultLayout(),
    saved,
    readNotes: () => readVaultNotes(options.generation),
    onConfig: async (config) => {
      await setJsonSecret(KORE_CLOUD_SECRET, {
        ...config,
        vaultRoot: options.vaultRoot,
      } satisfies StoredKoreCloud)
    },
    ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
    ...(options.onUpload === undefined ? {} : { onUpload: options.onUpload }),
  })
}

/** The saved Kore Cloud as a client: agents, revoking one, pushes. */
export function koreCloudClient(stored: StoredKoreCloud, fetchFn: Fetch): KoreCloud {
  return new KoreCloud(stored.url, stored.ownerKey, fetchFn)
}

/** Send the open vault's notes Kore Cloud lacks (no Cloudflare token needed). */
export async function uploadVaultToKoreCloud(
  stored: StoredKoreCloud,
  fetchFn: Fetch,
  generation: number,
  onUpload?: (sent: number, total: number) => void,
): Promise<UploadReport> {
  const cloud = koreCloudClient(stored, fetchFn)
  await waitForWorker(cloud)
  return await uploadNotes(cloud, await readVaultNotes(generation), onUpload)
}
