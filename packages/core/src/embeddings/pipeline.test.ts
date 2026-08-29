import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { embedNote } from './pipeline'

afterEach(() => {
  setBridge(null)
})

interface AppliedChunk {
  heading: string | null
  posFrom: number
  posTo: number
  text: string
  contentHash: string
  vector: number[] | null
}

/**
 * Bridge fake for the pipeline: a note on "disk", stored hash+model rows for
 * the db_query the diff makes, and capture of embed_texts / embed_apply.
 * `descriptions` answers reads of `<asset>.reflect.md` sidecars; any other
 * sidecar read gets the Rust layer's notFound.
 */
function fakePipelineBridge(options: {
  content: string
  /**
   * Rows the diff's `db_query` finds. Shaped like the real select, position
   * metadata included: the pipeline compares it to decide whether an
   * `embed_apply` would change anything at all.
   */
  storedRows: Array<{
    content_hash: string
    model_id: string
    heading: string | null
    pos_from: number
    pos_to: number
  }>
  descriptions?: Record<string, string>
  /** Report the note itself as iCloud-evicted (bytes not local). */
  evicted?: boolean
  /** Sidecar paths (`<asset>.reflect.md`) to report as iCloud-evicted. */
  evictedSidecars?: string[]
  /** Stand in for the runtime's response to one `embed_texts` batch. */
  embed?: (texts: string[]) => number[][] | Promise<number[][]>
}) {
  const embedded: string[][] = []
  const applied: { path: string; chunks: AppliedChunk[] }[] = []
  setBridge({
    invoke: async (command, args) => {
      if (command === 'note_read_local') {
        const path = (args as { path: string }).path
        if (path.endsWith('.reflect.md')) {
          if (options.evictedSidecars?.includes(path) === true) {
            return { kind: 'evicted' }
          }
          const description = options.descriptions?.[path]
          if (description === undefined) {
            throw { kind: 'notFound', message: `no description at ${path}` }
          }
          return { kind: 'content', content: description }
        }
        if (options.evicted === true) {
          return { kind: 'evicted' }
        }
        return { kind: 'content', content: options.content }
      }
      if (command === 'db_query') {
        return options.storedRows
      }
      if (command === 'embed_texts') {
        const texts = (args as { texts: string[] }).texts
        embedded.push(texts)
        return options.embed ? await options.embed(texts) : texts.map(() => [0.5, 0.5])
      }
      if (command === 'embed_apply') {
        const { path, chunks } = args as { path: string; chunks: AppliedChunk[] }
        applied.push({ path, chunks })
        return null
      }
      if (command === 'embed_remove') {
        applied.push({ path: (args as { path: string }).path, chunks: [] })
        return null
      }
      return null
    },
    listen: async () => () => {},
  })
  return { embedded, applied }
}

const MODEL = 'all-MiniLM-L6-v2'

/**
 * A stored row whose position metadata deliberately does not match what the
 * pass would write, so these cases keep exercising the write path rather than
 * the "already up to date" early return.
 */
function staleRow(contentHash: string, modelId = MODEL) {
  return { content_hash: contentHash, model_id: modelId, heading: null, pos_from: -1, pos_to: -1 }
}

describe('embedNote', () => {
  it('never embeds a template — boilerplate must not reach retrieval', async () => {
    const { embedded, applied } = fakePipelineBridge({
      content: '# Journal\n\nMood:\n\nGratitude:\n',
      storedRows: [],
    })
    const count = await embedNote({ path: 'templates/journal.md', generation: 1, modelId: MODEL })
    expect(count).toBe(0)
    expect(embedded).toHaveLength(0)
    expect(applied).toHaveLength(0)
  })

  it('skips an iCloud-evicted note without touching its stored vectors', async () => {
    // Reading an evicted note would force a blocking on-demand download —
    // the backfill must skip it, and must not embed_remove: the
    // pre-eviction vectors stay valid until new content materializes.
    const { embedded, applied } = fakePipelineBridge({
      content: '# One\n\nAlpha text.\n',
      storedRows: [],
      evicted: true,
    })
    const count = await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    expect(count).toBe(0)
    expect(embedded).toHaveLength(0)
    expect(applied).toHaveLength(0) // neither embed_apply nor embed_remove
  })

  it('embeds everything for a brand-new note', async () => {
    const { embedded, applied } = fakePipelineBridge({
      content: '# One\n\nAlpha text.\n\n# Two\n\nBeta text.\n',
      storedRows: [],
    })
    const count = await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    expect(count).toBe(2)
    expect(embedded).toHaveLength(1) // one batched embed_texts call
    expect(applied[0]!.chunks.every((chunk) => chunk.vector !== null)).toBe(true)
  })

  it('the hash-skip embeds nothing when stored hashes match', async () => {
    const content = '# One\n\nAlpha text.\n'
    // First pass captures the chunk hash the second pass will find "stored".
    const first = fakePipelineBridge({ content, storedRows: [] })
    await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    const hash = first.applied[0]!.chunks[0]!.contentHash

    // The stored row's position is stale, so the write still has something to
    // do: reuse the vector, refresh the metadata.
    const stored = first.applied[0]!.chunks[0]!
    const second = fakePipelineBridge({
      content,
      storedRows: [
        {
          content_hash: hash,
          model_id: MODEL,
          heading: stored.heading,
          pos_from: stored.posFrom + 100,
          pos_to: stored.posFrom + 200,
        },
      ],
    })
    const count = await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    expect(count).toBe(0)
    expect(second.embedded).toHaveLength(0) // nothing re-embedded
    expect(second.applied[0]!.chunks[0]!.vector).toBeNull() // metadata-only row
  })

  it('writes nothing at all when the stored rows already match', async () => {
    // The launch path: the backfill walks an unchanged graph. Every chunk skips
    // AND the stored metadata is already right, so `embed_apply` would be a
    // writer-lock transaction full of no-op UPDATEs, shipping every chunk's
    // full text over IPC to achieve nothing.
    const content = '# One\n\nAlpha text.\n\n# Two\n\nBeta text.\n'
    const first = fakePipelineBridge({ content, storedRows: [] })
    await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    const written = first.applied[0]!.chunks

    const second = fakePipelineBridge({
      content,
      storedRows: written.map((chunk) => ({
        content_hash: chunk.contentHash,
        model_id: MODEL,
        heading: chunk.heading,
        pos_from: chunk.posFrom,
        pos_to: chunk.posTo,
      })),
    })
    expect(await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })).toBe(0)
    expect(second.embedded).toHaveLength(0)
    expect(second.applied).toHaveLength(0) // no embed_apply at all
  })

  it('still writes when the note shrank, so orphaned rows get dropped', async () => {
    // Every surviving chunk skips, but there are more stored rows than chunks.
    // Returning early here would strand the rows `apply_chunks` deletes.
    const content = '# One\n\nAlpha text.\n'
    const first = fakePipelineBridge({ content, storedRows: [] })
    await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    const kept = first.applied[0]!.chunks[0]!

    const second = fakePipelineBridge({
      content,
      storedRows: [
        {
          content_hash: kept.contentHash,
          model_id: MODEL,
          heading: kept.heading,
          pos_from: kept.posFrom,
          pos_to: kept.posTo,
        },
        { content_hash: 'orphan', model_id: MODEL, heading: null, pos_from: 999, pos_to: 1000 },
      ],
    })
    expect(await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })).toBe(0)
    expect(second.embedded).toHaveLength(0)
    expect(second.applied).toHaveLength(1) // the write that prunes the orphan
    expect(second.applied[0]!.chunks).toHaveLength(1)
  })

  it('bounds native calls and preserves vector order in one atomic note write', async () => {
    const content = Array.from(
      { length: 41 },
      (_, index) => `# Section ${index}\n\nText.\n\n`,
    ).join('')
    const { embedded, applied } = fakePipelineBridge({
      content,
      storedRows: [],
      embed: (texts) => texts.map((text) => [Number(text.match(/Section (\d+)/)?.[1])]),
    })
    expect(await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })).toBe(41)
    expect(embedded.map((batch) => batch.length)).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1])
    expect(applied).toHaveLength(1)
    expect(applied[0]!.chunks.map((chunk) => chunk.vector)).toEqual(
      Array.from({ length: 41 }, (_, index) => [index]),
    )
  })

  it('stops between batches without replacing a note with partial vectors', async () => {
    let stale = false
    const content = Array.from(
      { length: 40 },
      (_, index) => `# Section ${index}\n\nText.\n\n`,
    ).join('')
    const { embedded, applied } = fakePipelineBridge({
      content,
      storedRows: [],
      embed: (texts) => {
        stale = true
        return texts.map(() => [0.5, 0.5])
      },
    })
    const count = await embedNote({
      path: 'notes/a.md',
      generation: 1,
      modelId: MODEL,
      isStale: () => stale,
    })
    expect(count).toBe(0)
    expect(embedded).toHaveLength(1)
    expect(applied).toHaveLength(0)
  })

  it('does not persist an incomplete runtime response', async () => {
    const { applied } = fakePipelineBridge({
      content: '# One\n\nAlpha.\n',
      storedRows: [],
      embed: () => [],
    })
    await expect(embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })).rejects.toThrow(
      'incomplete batch',
    )
    expect(applied).toHaveLength(0)
  })

  it('does not replace vectors when cancelled during the final batch', async () => {
    let stale = false
    const { applied } = fakePipelineBridge({
      content: '# One\n\nAlpha.\n',
      storedRows: [],
      embed: (texts) => {
        stale = true
        return texts.map(() => [0.5, 0.5])
      },
    })
    expect(
      await embedNote({
        path: 'notes/a.md',
        generation: 1,
        modelId: MODEL,
        isStale: () => stale,
      }),
    ).toBe(0)
    expect(applied).toHaveLength(0)
  })

  it('does not remove vectors when cancelled while reading an empty note', async () => {
    const { applied } = fakePipelineBridge({ content: '\n', storedRows: [] })
    let stale = false
    const work = embedNote({
      path: 'notes/a.md',
      generation: 1,
      modelId: MODEL,
      isStale: () => stale,
    })
    stale = true
    expect(await work).toBe(0)
    expect(applied).toHaveLength(0)
  })

  it('a model change re-embeds chunks whose hashes are unchanged', async () => {
    const content = '# One\n\nAlpha text.\n'
    const first = fakePipelineBridge({ content, storedRows: [] })
    await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    const hash = first.applied[0]!.chunks[0]!.contentHash

    const second = fakePipelineBridge({
      content,
      storedRows: [staleRow(hash, 'old-model')],
    })
    const count = await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    expect(count).toBe(1) // same hash, different model → new vector
    expect(second.embedded).toHaveLength(1)
  })

  it('duplicate-hash chunks only skip as many embeds as rows exist', async () => {
    // Two byte-identical sections (above the runt-merge threshold) produce
    // two chunks with one hash.
    const section = `# A\n\n${'The same sentence again. '.repeat(12)}\n`
    const dup = section + section
    const first = fakePipelineBridge({ content: dup, storedRows: [] })
    await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    const hashes = first.applied[0]!.chunks.map((chunk) => chunk.contentHash)
    expect(hashes[0]).toBe(hashes[1]) // genuinely duplicated chunks

    // Only ONE stored row for that hash: exactly one chunk may skip; the
    // other must re-embed (vector present), or apply_chunks errors loudly.
    const second = fakePipelineBridge({
      content: dup,
      storedRows: [staleRow(hashes[0]!)],
    })
    const count = await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    expect(count).toBe(1)
    const sent = second.applied[0]!.chunks
    expect(sent.filter((chunk) => chunk.vector === null)).toHaveLength(1)
    expect(sent.filter((chunk) => chunk.vector !== null)).toHaveLength(1)
  })

  it('an emptied note drops its chunks via embed_remove', async () => {
    const { applied } = fakePipelineBridge({ content: '\n', storedRows: [] })
    const count = await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    expect(count).toBe(0)
    expect(applied).toEqual([{ path: 'notes/a.md', chunks: [] }])
  })

  const IMAGE_NOTE = '# Trip\n\nSome notes about the day.\n\n![photo](assets/pic.png)\n'
  const PIC_DESCRIPTION =
    '---\nreflectAsset: true\nsource: assets/pic.png\n---\n\nA red bridge over a misty river at dawn.\n'

  it('embeds asset description chunks after the note’s own chunks', async () => {
    const { applied } = fakePipelineBridge({
      content: IMAGE_NOTE,
      storedRows: [],
      descriptions: { 'assets/pic.png.reflect.md': PIC_DESCRIPTION },
    })
    const count = await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    expect(count).toBeGreaterThanOrEqual(2) // note chunk(s) + the asset chunk

    const chunks = applied[0]!.chunks
    const assetChunk = chunks[chunks.length - 1]!
    expect(assetChunk.heading).toBe('pic.png')
    expect(assetChunk.text).toContain('red bridge over a misty river')
    expect(assetChunk.text).not.toContain('reflectAsset') // frontmatter stripped
    // Synthetic positions live past the note source, so asset chunks order last.
    expect(assetChunk.posFrom).toBeGreaterThan(IMAGE_NOTE.length)
    expect(chunks.slice(0, -1).every((chunk) => chunk.posFrom < IMAGE_NOTE.length)).toBe(true)
  })

  it('skips the whole note while a referenced sidecar is evicted — chunks survive', async () => {
    // embed_apply replaces the note's entire chunk set; applying without the
    // evicted sidecar's body would silently drop its previously embedded
    // chunks, and sidecars are untracked so nothing would restore them.
    const { embedded, applied } = fakePipelineBridge({
      content: IMAGE_NOTE,
      storedRows: [staleRow('previously-stored')],
      evictedSidecars: ['assets/pic.png.reflect.md'],
    })
    const count = await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    expect(count).toBe(0)
    expect(embedded).toHaveLength(0)
    expect(applied).toHaveLength(0) // neither embed_apply nor embed_remove
  })

  it('a note without a description for its asset embeds only its own text', async () => {
    const { applied } = fakePipelineBridge({ content: IMAGE_NOTE, storedRows: [] })
    await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    expect(applied[0]!.chunks.every((chunk) => chunk.posFrom < IMAGE_NOTE.length)).toBe(true)
  })

  it('the hash-skip covers unchanged asset description chunks', async () => {
    const descriptions = { 'assets/pic.png.reflect.md': PIC_DESCRIPTION }
    const first = fakePipelineBridge({ content: IMAGE_NOTE, storedRows: [], descriptions })
    await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    const storedRows = first.applied[0]!.chunks.map((chunk) => ({
      content_hash: chunk.contentHash,
      model_id: MODEL,
      heading: chunk.heading,
      pos_from: chunk.posFrom,
      pos_to: chunk.posTo,
    }))

    const second = fakePipelineBridge({ content: IMAGE_NOTE, storedRows, descriptions })
    const count = await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    expect(count).toBe(0)
    expect(second.embedded).toHaveLength(0)
  })

  it('a rewritten description re-embeds only the asset chunk', async () => {
    const first = fakePipelineBridge({
      content: IMAGE_NOTE,
      storedRows: [],
      descriptions: { 'assets/pic.png.reflect.md': PIC_DESCRIPTION },
    })
    await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    const storedRows = first.applied[0]!.chunks.map((chunk) => ({
      content_hash: chunk.contentHash,
      model_id: MODEL,
      heading: chunk.heading,
      pos_from: chunk.posFrom,
      pos_to: chunk.posTo,
    }))

    const second = fakePipelineBridge({
      content: IMAGE_NOTE,
      storedRows,
      descriptions: {
        'assets/pic.png.reflect.md': '---\nreflectAsset: true\n---\n\nNow a snowy mountain pass.\n',
      },
    })
    const count = await embedNote({ path: 'notes/a.md', generation: 1, modelId: MODEL })
    expect(count).toBe(1)
    expect(second.embedded).toEqual([['Now a snowy mountain pass.']])
  })
})
