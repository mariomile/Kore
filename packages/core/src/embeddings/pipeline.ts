import { readNoteLocal } from '../graph/commands'
import { isTemplatePath } from '../graph/paths'
import { gatherAssetDescriptionBodies } from '../indexing/asset-description-text'
import { db } from '../indexing/db'
import { parseNote } from '../markdown'
import { chunkAssetDescriptions, chunkNote } from './chunk'
import {
  EMBEDDING_BATCH_SIZE,
  embedApply,
  embedRemove,
  embedTexts,
  type EmbedChunkPayload,
} from './commands'

/**
 * The incremental embedding pass (Plan 09): chunk a note, diff chunk hashes
 * against the stored rows, embed only what changed, and apply as one
 * generation-pinned write. TS owns this orchestration (Rust supplies
 * `embed_texts` + the table writes), mirroring the indexing pipeline.
 *
 * A note's chunk set also carries its referenced assets' description bodies
 * (Plan 20 → semantic leg), mirroring the FTS fold — so a meaning-level query
 * about an image or PDF's contents surfaces the referencing note on the
 * semantic side of hybrid retrieval, not just on keyword matches.
 */

export interface EmbedNoteOptions {
  path: string
  generation: number
  /** The model recorded per vector (from the runtime's `ready` status). */
  modelId: string
  /** Pre-loaded content (the watcher path has it); read from disk if absent. */
  content?: string
  /** Stop between inference batches when this work has been superseded. */
  isStale?: () => boolean
}

/**
 * Bring one note's embeddings up to date. Returns the number of chunks that
 * were (re)embedded — 0 means the hash-skip caught everything, the note was
 * skipped, or the pass was cancelled before it wrote anything.
 */
export async function embedNote(options: EmbedNoteOptions): Promise<number> {
  const { path, generation, modelId, isStale = () => false } = options
  if (isTemplatePath(path) || isStale()) {
    return 0 // templates are boilerplate — never embedded, never retrieved
  }
  let content = options.content
  if (content === undefined) {
    let read: Awaited<ReturnType<typeof readNoteLocal>>
    try {
      read = await readNoteLocal(path)
    } catch {
      return 0 // deleted between event and read; the remove path handles it
    }
    if (read.kind === 'evicted') {
      // iCloud-evicted: reading would force an on-demand download, and the
      // backfill sweeping a whole evicted graph would turn into thousands of
      // serial blocking downloads. The pre-eviction vectors stay valid (rows
      // survive eviction); if the note re-materializes with new content, the
      // index-applied follow-up re-embeds it then.
      return 0
    }
    content = read.content
  }

  const parsed = parseNote({ path, source: content })
  const gathered = await gatherAssetDescriptionBodies(parsed.assets.map((asset) => asset.path))
  if (gathered.evicted.length > 0) {
    // A referenced sidecar is iCloud-evicted. `embedApply` replaces the
    // note's *entire* chunk set, so applying without that sidecar's body
    // would silently drop its previously embedded chunks — and sidecars are
    // untracked by the watcher, so nothing would ever restore them. Skip the
    // whole note this pass; the stored vectors stay valid until the sidecar
    // is local again.
    return 0
  }
  const chunks = [
    ...(await chunkNote(path, content, parsed)),
    ...(await chunkAssetDescriptions(gathered.bodies, content.length + 1)),
  ]
  if (isStale()) {
    return 0
  }
  if (chunks.length === 0) {
    await embedRemove(path, generation)
    return 0
  }

  // Stored hash+model pairs, **counted**: duplicate identical sections mean
  // several chunks can share one hash, and only as many may skip embedding as
  // there are stored rows to pair with (apply_chunks pairs one row per
  // skipped chunk — an unmatched skip is a loud error). A model change makes
  // every chunk "new", so a model switch re-embeds with no extra bookkeeping.
  const existing = await db
    .selectFrom('embeddingChunks')
    .where('notePath', '=', path)
    .select(['contentHash', 'modelId', 'heading', 'posFrom', 'posTo'])
    .execute()
  const available = new Map<string, number>()
  for (const row of existing) {
    const key = `${row.modelId} ${row.contentHash}`
    available.set(key, (available.get(key) ?? 0) + 1)
  }

  const skip = chunks.map((chunk) => {
    const key = `${modelId} ${chunk.contentHash}`
    const remaining = available.get(key) ?? 0
    if (remaining > 0) {
      available.set(key, remaining - 1)
      return true
    }
    return false
  })
  const toEmbed = chunks.filter((_, i) => !skip[i])
  // Nothing to embed and the stored rows already say exactly what we would
  // write: the whole `embedApply` is a no-op, so skip it. Without this an
  // unchanged note still cost one writer-lock transaction and one dead UPDATE
  // per chunk, and shipped every chunk's full text over IPC to do it. That is
  // not only the repair path: the backfill runs on every launch with semantic
  // search on, so a 5,000-note graph paid ~5,000 transactions and ~40,000 dead
  // updates per start, contending with the initial reconcile's own writes.
  //
  // Position and heading are part of the comparison because `embedApply` would
  // otherwise be the thing that refreshes them. The vector-reuse decision above
  // stays keyed on hash and model alone: a chunk that only moved must keep its
  // vector, not be re-embedded.
  if (toEmbed.length === 0 && sameChunkRows(existing, chunks, modelId)) {
    return 0
  }
  // Batched rather than one call per note: a long note produces hundreds of
  // chunks, and handing them to the runtime in one go is what made a single
  // note cost gigabytes. Cancellation is checked between batches, never
  // mid-note after a partial write — `embedApply` replaces a note's *entire*
  // chunk set, so applying half the vectors would drop the rest.
  const vectors: number[][] = []
  for (let offset = 0; offset < toEmbed.length; offset += EMBEDDING_BATCH_SIZE) {
    if (isStale()) {
      return 0
    }
    const batch = toEmbed.slice(offset, offset + EMBEDDING_BATCH_SIZE)
    const embedded = await embedTexts(batch.map((chunk) => chunk.text))
    if (embedded.length !== batch.length) {
      throw new Error('the embedding runtime returned an incomplete batch')
    }
    vectors.push(...embedded)
  }
  if (isStale()) {
    return 0
  }
  let vectorAt = 0

  const payload: EmbedChunkPayload[] = chunks.map((chunk, i) => ({
    heading: chunk.heading,
    posFrom: chunk.posFrom,
    posTo: chunk.posTo,
    text: chunk.text,
    contentHash: chunk.contentHash,
    modelId,
    // A non-skipped chunk always has a freshly-embedded vector: `vectors` is
    // exactly as long as the non-skipped chunks, consumed in order here.
    vector: skip[i] ? null : vectors[vectorAt++]!,
  }))
  await embedApply(path, payload, generation)
  return toEmbed.length
}

/**
 * Backfill every indexed note (initial enable, repair). Serialized; the
 * hash-skip makes re-runs cheap. Reports per-note progress.
 */
export async function backfillEmbeddings(options: {
  generation: number
  modelId: string
  onProgress?: (done: number, total: number) => void
  /** Abort between inference batches and between notes (e.g. graph switch). */
  isStale?: () => boolean
}): Promise<'completed' | 'aborted'> {
  const { generation, modelId, onProgress, isStale = () => false } = options
  const rows = await db
    .selectFrom('notes')
    .where('kind', '!=', 'template')
    .select('path')
    .orderBy('path')
    .execute()
  let done = 0
  for (const row of rows) {
    if (isStale()) {
      return 'aborted'
    }
    try {
      await embedNote({ path: row.path, generation, modelId, isStale })
      if (isStale()) {
        return 'aborted'
      }
    } catch (cause) {
      console.error(`embedding backfill failed for ${row.path}:`, cause)
    }
    done += 1
    onProgress?.(done, rows.length)
  }
  return 'completed'
}

/** One stored chunk row's identity, for comparing against what we would write. */
function chunkRowKey(row: {
  contentHash: string
  modelId: string
  heading: string | null
  posFrom: number
  posTo: number
}): string {
  return [row.modelId, row.contentHash, row.heading ?? '', row.posFrom, row.posTo].join('\u{0}')
}

/**
 * Whether the stored rows are already exactly the rows this pass would write.
 *
 * A multiset comparison, not a set one: a note that repeats a section produces
 * several chunks sharing a hash, and losing that count would call a shrunk note
 * unchanged and leave orphaned rows behind that `apply_chunks` would have
 * deleted.
 */
function sameChunkRows(
  existing: readonly {
    contentHash: string
    modelId: string
    heading: string | null
    posFrom: number
    posTo: number
  }[],
  chunks: readonly {
    contentHash: string
    heading: string | null
    posFrom: number
    posTo: number
  }[],
  modelId: string,
): boolean {
  if (existing.length !== chunks.length) {
    return false
  }
  const counts = new Map<string, number>()
  for (const row of existing) {
    const key = chunkRowKey(row)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const chunk of chunks) {
    const key = chunkRowKey({ ...chunk, modelId })
    const remaining = counts.get(key) ?? 0
    if (remaining === 0) {
      return false
    }
    counts.set(key, remaining - 1)
  }
  return true
}
