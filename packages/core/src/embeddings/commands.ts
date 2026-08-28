import { z } from 'zod'
import { getBridge, type Unlisten } from '../ipc/bridge'
import { call } from '../ipc/invoke'

/** Typed bindings for the Rust embedding runtime + vector writes (Plan 09). */

/** Byte counts for an active model download; absent until it starts. */
export const embedProgressSchema = z.object({
  /** Bytes fetched so far. */
  downloaded: z.number().int().nonnegative(),
  /** Bytes the download will fetch in total. */
  total: z.number().int().nonnegative(),
})
export type EmbedProgress = z.infer<typeof embedProgressSchema>

export const embedStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('uninitialized') }),
  z.object({
    status: z.literal('loading'),
    progress: embedProgressSchema.optional(),
  }),
  z.object({ status: z.literal('ready'), model: z.string() }),
  /**
   * Loaded earlier and released after idling. Semantic search is still
   * available — an embed call reloads the model from the local cache — so
   * this must never be treated as "unavailable" the way `uninitialized` is.
   */
  z.object({ status: z.literal('unloaded'), model: z.string() }),
  z.object({ status: z.literal('failed'), message: z.string() }),
])
export type EmbedStatus = z.infer<typeof embedStatusSchema>

const voidSchema = z.null()
const vectorsSchema = z.array(z.array(z.number()))

export function embedStatus(): Promise<EmbedStatus> {
  return call('embed_status', {}, embedStatusSchema)
}

/** Load (downloading on first use) the model. Resolves with the outcome. */
export function embedEnsure(): Promise<EmbedStatus> {
  return call('embed_ensure', {}, embedStatusSchema)
}

/**
 * Texts per `embedTexts` call, mirroring `EMBED_BATCH_SIZE` in `embed.rs`.
 *
 * The runtime bounds its own batches whatever arrives, so this is not what
 * keeps memory in check — it is what keeps an IPC payload small and a long
 * pass interruptible, by giving callers a point to stop between batches
 * rather than only between notes.
 */
export const EMBEDDING_BATCH_SIZE = 16

/** Embed texts → 384-dim vectors. Errors unless status is `ready`. */
export function embedTexts(texts: string[]): Promise<number[][]> {
  return call('embed_texts', { texts }, vectorsSchema)
}

/** One chunk in the `embed_apply` payload; `vector` only for new/changed. */
export interface EmbedChunkPayload {
  heading: string | null
  posFrom: number
  posTo: number
  text: string
  contentHash: string
  modelId: string
  vector: number[] | null
}

/** Replace a note's chunk set (hash-diff applied in Rust; generation-pinned). */
export async function embedApply(
  path: string,
  chunks: EmbedChunkPayload[],
  generation: number,
): Promise<void> {
  await call('embed_apply', { path, chunks, generation }, voidSchema)
}

/** Drop a deleted note's chunks + vectors (generation-pinned). */
export async function embedRemove(path: string, generation: number): Promise<void> {
  await call('embed_remove', { path, generation }, voidSchema)
}

/** Live runtime status changes (download started/finished/failed). */
export function subscribeEmbedStatus(handler: (status: EmbedStatus) => void): Promise<Unlisten> {
  return getBridge().listen('embed:status', (payload) => {
    const parsed = embedStatusSchema.safeParse(payload)
    if (parsed.success) {
      handler(parsed.data)
    } else {
      console.error('invalid embed:status payload:', parsed.error)
    }
  })
}
