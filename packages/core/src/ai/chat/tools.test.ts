import { describe, expect, it } from 'vitest'
import type { ToolExecutionOptions } from 'ai'
import type { RetrievalHit, RetrieveOptions } from '../../embeddings/retrieve'
import type { DailyNoteRow, DailyNotesRange } from '../../indexing/queries'
import type { RecentNoteRow, RecentNotesOptions } from '../../indexing/note-list'
import {
  ASSET_UNAVAILABLE_ERROR,
  MAX_ASSET_DESCRIPTION_CHARS,
  NO_ASSET_DESCRIPTION_ERROR,
  NOT_AN_ASSET_ERROR,
  type ReadAssetResult,
  type ReadAssetsOutput,
} from './read-assets'
import { MAX_NOTE_CONTENT_CHARS, type ReadNoteResult, type ReadNotesOutput } from './read-notes'
import {
  buildNoteTools,
  INVALID_COLLECTION_TAG_ERROR,
  INVALID_TAG_ERROR,
  MAX_DAILY_NOTE_DAYS,
  UNTYPED_TAG_ERROR,
  EDITS_DISABLED_ERROR,
  RESERVED_PROPERTY_ERROR,
  PRIVATE_NOTE_EDIT_ERROR,
  MISSING_VALUE_ERROR,
  formatPropertyPreview,
  noteToolResult,
  type SetNotePropertyOutput,
  type ListCollectionOutput,
  type ListDailyNotesOutput,
  type ListRecentNotesOutput,
  type NoteTools,
  type SearchNotesOutput,
} from './tools'
import type { CollectionEntry } from '../../indexing/collections'
import type { TagType } from '../../tags'

const CALL: ToolExecutionOptions<Record<string, unknown>> = {
  toolCallId: 'call-1',
  messages: [],
  context: {},
}

// Sentinels that cannot collide with prompt copy or fixture prose, so the
// not-in-payload assertions below can never pass vacuously.
const PRIVATE_TITLE = 'sentinel-title-01jxq3'
const PRIVATE_PATH = 'notes/sentinel-path-01jxq3.md'
const PRIVATE_BODY = 'sentinel-body-01jxq3'

/** A public retrieval hit, overridable per test. */
function hit(overrides: Partial<RetrievalHit>): RetrievalHit {
  return {
    path: 'notes/public.md',
    title: 'Public note',
    score: 1,
    snippet: 'a public snippet',
    heading: null,
    isPrivate: false,
    ...overrides,
  }
}

/** A public recents query row, overridable per test. */
function recentRow(overrides: Partial<RecentNoteRow>): RecentNoteRow {
  return {
    path: 'notes/public.md',
    title: 'Public note',
    preview: 'a public preview',
    mtime: 1_750_000_000_000,
    isPrivate: false,
    ...overrides,
  }
}

/** A public daily query row for `date`, overridable per test. */
function dailyRow(date: string, overrides: Partial<DailyNoteRow> = {}): DailyNoteRow {
  return {
    path: `daily/${date}.md`,
    title: date,
    dailyDate: date,
    preview: 'a daily preview',
    mtime: 1_750_000_000_000,
    isPrivate: false,
    ...overrides,
  }
}

function isAsyncIterable(value: object): value is AsyncIterable<unknown> {
  return Symbol.asyncIterator in value
}

/** Execute `search_notes` directly, asserting a non-streaming output. */
async function runSearch(
  tools: NoteTools,
  input: { query: string; limit?: number },
): Promise<SearchNotesOutput> {
  const execute = tools.search_notes.execute
  if (!execute) {
    throw new Error('search_notes has no execute')
  }
  const output = await execute(input, CALL)
  if (isAsyncIterable(output)) {
    throw new Error('unexpected streaming tool output')
  }
  return output
}

/** Execute `read_notes` directly, asserting a non-streaming output. */
async function runReadNotes(tools: NoteTools, paths: string[]): Promise<ReadNotesOutput> {
  const execute = tools.read_notes.execute
  if (!execute) {
    throw new Error('read_notes has no execute')
  }
  const output = await execute({ paths }, CALL)
  if (isAsyncIterable(output)) {
    throw new Error('unexpected streaming tool output')
  }
  return output
}

/** Read a single path via `read_notes`, returning its lone result. */
async function runRead(tools: NoteTools, path: string): Promise<ReadNoteResult> {
  const [note] = (await runReadNotes(tools, [path])).notes
  if (note === undefined) {
    throw new Error('read_notes returned no notes')
  }
  return note
}

/** Execute `read_assets` directly, asserting a non-streaming output. */
async function runReadAssets(tools: NoteTools, paths: string[]): Promise<ReadAssetsOutput> {
  const execute = tools.read_assets.execute
  if (!execute) {
    throw new Error('read_assets has no execute')
  }
  const output = await execute({ paths }, CALL)
  if (isAsyncIterable(output)) {
    throw new Error('unexpected streaming tool output')
  }
  return output
}

/** Read a single asset via `read_assets`, returning its lone result. */
async function runReadAsset(tools: NoteTools, path: string): Promise<ReadAssetResult> {
  const [asset] = (await runReadAssets(tools, [path])).assets
  if (asset === undefined) {
    throw new Error('read_assets returned no assets')
  }
  return asset
}

/** Execute `list_recent_notes` directly, asserting a non-streaming output. */
async function runRecents(
  tools: NoteTools,
  input: { limit?: number; tag?: string | null },
): Promise<ListRecentNotesOutput> {
  const execute = tools.list_recent_notes.execute
  if (!execute) {
    throw new Error('list_recent_notes has no execute')
  }
  const output = await execute(input, CALL)
  if (isAsyncIterable(output)) {
    throw new Error('unexpected streaming tool output')
  }
  return output
}

/** Execute `list_daily_notes` directly, asserting a non-streaming output. */
async function runDailies(
  tools: NoteTools,
  input: { start: string; end: string },
): Promise<ListDailyNotesOutput> {
  const execute = tools.list_daily_notes.execute
  if (!execute) {
    throw new Error('list_daily_notes has no execute')
  }
  const output = await execute(input, CALL)
  if (isAsyncIterable(output)) {
    throw new Error('unexpected streaming tool output')
  }
  return output
}

/** Execute `list_collection` directly, asserting a non-streaming output. */
async function runCollection(
  tools: NoteTools,
  input: {
    tag: string
    sortBy?: string | null
    direction?: 'asc' | 'desc' | null
    limit?: number
  },
): Promise<ListCollectionOutput> {
  const execute = tools.list_collection.execute
  if (!execute) {
    throw new Error('list_collection has no execute')
  }
  const output = await execute(input, CALL)
  if (isAsyncIterable(output)) {
    throw new Error('unexpected streaming tool output')
  }
  return output
}

/** A public collection row, overridable per test. */
function collectionRow(overrides: Partial<CollectionEntry>): CollectionEntry {
  return {
    path: 'notes/public.md',
    title: 'Public note',
    mtime: 1_750_000_000_000,
    isPinned: false,
    properties: {
      author: { value: 'Le Guin', valueType: 'string', valueNumber: null },
      rating: { value: '4.5', valueType: 'number', valueNumber: 4.5 },
    },
    ...overrides,
  }
}

const BOOK_TYPE: TagType = {
  properties: [
    { name: 'Author', key: 'author', type: 'text' },
    { name: 'Rating', key: 'rating', type: 'number' },
  ],
}

describe('search_notes', () => {
  it('always retrieves with excludePrivateContent', async () => {
    const seen: Array<RetrieveOptions | undefined> = []
    const tools = buildNoteTools({
      retrieveFn: async (_query, options) => {
        seen.push(options)
        return []
      },
    })
    await runSearch(tools, { query: 'atlas' })
    expect(seen).toEqual([{ limit: 8, mode: 'hybrid', excludePrivateContent: true }])
  })

  it('uses lexical retrieval when semantic search is disabled', async () => {
    const seen: Array<RetrieveOptions | undefined> = []
    const tools = buildNoteTools({
      semanticSearchEnabled: false,
      retrieveFn: async (_query, options) => {
        seen.push(options)
        return []
      },
    })
    await runSearch(tools, { query: 'atlas' })
    expect(seen).toEqual([{ limit: 8, mode: 'lexical', excludePrivateContent: true }])
  })

  it('drops private hits entirely — not even the title goes out', async () => {
    const tools = buildNoteTools({
      retrieveFn: async () => [
        hit({}),
        hit({ path: PRIVATE_PATH, title: PRIVATE_TITLE, snippet: '', isPrivate: true }),
      ],
      readNoteFn: async () => 'a public body\n',
    })
    const output = await runSearch(tools, { query: 'diary' })
    const payload = JSON.stringify(output)
    expect(payload).not.toContain(PRIVATE_TITLE)
    expect(payload).not.toContain(PRIVATE_PATH)
    expect(output.hits).toEqual([
      { path: 'notes/public.md', title: 'Public note', snippet: 'a public snippet', heading: null },
    ])
  })

  it('drops a hit whose live frontmatter turned private before reindex (TOCTOU)', async () => {
    const tools = buildNoteTools({
      // The stale index still says public…
      retrieveFn: async () => [hit({ path: PRIVATE_PATH, title: PRIVATE_TITLE })],
      // …but the note on disk was just marked private.
      readNoteFn: async () => '---\nprivate: true\n---\n# Diary\n',
    })
    const output = await runSearch(tools, { query: 'diary' })
    expect(output.hits).toEqual([])
    expect(JSON.stringify(output)).not.toContain(PRIVATE_TITLE)
  })

  it('fails closed: an unreadable hit is dropped, not sent', async () => {
    const tools = buildNoteTools({
      retrieveFn: async () => [hit({ path: PRIVATE_PATH, title: PRIVATE_TITLE })],
      readNoteFn: async () => {
        throw { kind: 'io', message: 'disk error' }
      },
    })
    const output = await runSearch(tools, { query: 'diary' })
    expect(output.hits).toEqual([])
  })

  it('passes the requested limit through', async () => {
    const seen: Array<RetrieveOptions | undefined> = []
    const tools = buildNoteTools({
      retrieveFn: async (_query, options) => {
        seen.push(options)
        return []
      },
    })
    await runSearch(tools, { query: 'atlas', limit: 3 })
    expect(seen[0]?.limit).toBe(3)
  })
})

describe('read_notes', () => {
  it('reads several notes in one call, isolating a per-note miss', async () => {
    const bodies: Record<string, string> = {
      'notes/a.md': '# A\n\nAlpha.\n',
      'notes/b.md': '# B\n\nBeta.\n',
    }
    const tools = buildNoteTools({
      readNoteFn: async (path) => {
        const body = bodies[path]
        if (body === undefined) {
          throw { kind: 'notFound', message: 'no such note' }
        }
        return body
      },
    })
    const output = await runReadNotes(tools, ['notes/a.md', 'notes/gone.md', 'notes/b.md'])
    // Order is preserved and a missing note refuses on its own — the readable
    // notes around it still come back.
    expect(output.notes.map((note) => note.ok)).toEqual([true, false, true])
    expect(output.notes[1]).toMatchObject({ ok: false, path: 'notes/gone.md' })
  })

  it('returns the body without frontmatter, titled from the note', async () => {
    const tools = buildNoteTools({
      readNoteFn: async () => '---\npinned: true\n---\n# Project Atlas\n\nLaunch plan.\n',
    })
    const output = await runRead(tools, 'notes/atlas.md')
    if (!output.ok) {
      expect.unreachable('expected a successful read')
    }
    expect(output.note.title).toBe('Project Atlas')
    expect(output.note.content).toBe('# Project Atlas\n\nLaunch plan.\n')
    expect(output.note.truncated).toBe(false)
  })

  it('refuses a private note from its live frontmatter', async () => {
    const tools = buildNoteTools({
      readNoteFn: async () => `---\nprivate: true\n---\n# Diary\n\n${PRIVATE_BODY}\n`,
    })
    const output = await runRead(tools, PRIVATE_PATH)
    if (output.ok) {
      expect.unreachable('expected a refusal')
    }
    expect(output.error).toContain('private')
    expect(JSON.stringify(output)).not.toContain(PRIVATE_BODY)
  })

  it('reports a missing note instead of throwing', async () => {
    const tools = buildNoteTools({
      readNoteFn: async () => {
        throw { kind: 'notFound', message: 'no such note' }
      },
    })
    const output = await runRead(tools, 'notes/gone.md')
    if (output.ok) {
      expect.unreachable('expected a miss')
    }
    expect(output.error).toContain('No note exists')
  })

  it('caps oversized notes and flags the cut', async () => {
    const body = 'x'.repeat(MAX_NOTE_CONTENT_CHARS + 10)
    const tools = buildNoteTools({ readNoteFn: async () => body })
    const output = await runRead(tools, 'notes/big.md')
    if (!output.ok) {
      expect.unreachable('expected a successful read')
    }
    expect(output.note.content.length).toBe(MAX_NOTE_CONTENT_CHARS)
    expect(output.note.truncated).toBe(true)
  })
})

describe('read_assets', () => {
  const ASSET = 'assets/chart.png'
  const SIDECAR = 'assets/chart.png.reflect.md'
  const DESCRIPTION_BODY = 'sentinel-description-01jxq3'
  const PUBLIC_REF = '# Board deck\n\n![chart](assets/chart.png)\n'
  const PRIVATE_REF = `---\nprivate: true\n---\n# Diary\n\n![chart](assets/chart.png)\n`

  /** Tools over an in-memory file map + a fixed referencing-notes answer. */
  function assetTools(files: Record<string, string>, refs: string[]): NoteTools {
    return buildNoteTools({
      readNoteFn: async (path) => {
        const source = files[path]
        if (source === undefined) {
          throw { kind: 'notFound', message: 'no such file' }
        }
        return source
      },
      assetReferencingNotePathsFn: async () => refs,
    })
  }

  it('returns the sidecar body without frontmatter for a public-referenced asset', async () => {
    const tools = assetTools(
      {
        [SIDECAR]: `---\nreflectAsset: true\nsource: ${ASSET}\n---\nA bar chart.\n\nOCR: ${DESCRIPTION_BODY}\n`,
        'notes/deck.md': PUBLIC_REF,
      },
      ['notes/deck.md'],
    )
    const output = await runReadAsset(tools, ASSET)
    if (!output.ok) {
      expect.unreachable('expected a successful read')
    }
    expect(output.asset.path).toBe(ASSET)
    expect(output.asset.description).toBe(`A bar chart.\n\nOCR: ${DESCRIPTION_BODY}`)
    expect(output.asset.truncated).toBe(false)
  })

  it('canonicalizes markdown-spelled paths to the indexed assets/… form', async () => {
    const spacedSidecar = 'assets/chart one.png.reflect.md'
    const tools = assetTools(
      {
        [SIDECAR]: `---\nreflectAsset: true\n---\n${DESCRIPTION_BODY}\n`,
        [spacedSidecar]: `---\nreflectAsset: true\n---\n${DESCRIPTION_BODY}\n`,
        'notes/deck.md': '# Deck\n\n![a](assets/chart.png)\n\n![b](assets/chart%20one.png)\n',
      },
      ['notes/deck.md'],
    )
    for (const [spelled, canonical] of [
      ['./assets/chart.png', ASSET],
      ['assets/chart%20one.png', 'assets/chart one.png'],
    ] as const) {
      const output = await runReadAsset(tools, spelled)
      if (!output.ok) {
        expect.unreachable(`expected a successful read for ${spelled}`)
      }
      expect(output.asset.path).toBe(canonical)
      expect(output.asset.description).toBe(DESCRIPTION_BODY)
    }
  })

  it('reads several assets in one call, isolating a per-asset miss', async () => {
    const tools = assetTools(
      {
        [SIDECAR]: `---\nreflectAsset: true\n---\n${DESCRIPTION_BODY}\n`,
        'notes/deck.md': PUBLIC_REF,
      },
      ['notes/deck.md'],
    )
    const output = await runReadAssets(tools, [ASSET, 'assets/undescribed.pdf'])
    expect(output.assets.map((asset) => asset.ok)).toEqual([true, false])
    expect(output.assets[1]).toMatchObject({
      ok: false,
      path: 'assets/undescribed.pdf',
      error: NO_ASSET_DESCRIPTION_ERROR,
    })
  })

  it('refuses when any referencing note is private — live, and without the description', async () => {
    const tools = assetTools(
      {
        [SIDECAR]: `---\nreflectAsset: true\n---\n${DESCRIPTION_BODY}\n`,
        'notes/deck.md': PUBLIC_REF,
        [PRIVATE_PATH]: PRIVATE_REF,
      },
      ['notes/deck.md', PRIVATE_PATH],
    )
    const output = await runReadAsset(tools, ASSET)
    if (output.ok) {
      expect.unreachable('expected a refusal')
    }
    expect(output.error).toBe(ASSET_UNAVAILABLE_ERROR)
    expect(JSON.stringify(output)).not.toContain(DESCRIPTION_BODY)
  })

  it('refuses an asset no note references, with the same unspecific message', async () => {
    const tools = assetTools(
      { [SIDECAR]: `---\nreflectAsset: true\n---\n${DESCRIPTION_BODY}\n` },
      [],
    )
    const output = await runReadAsset(tools, ASSET)
    if (output.ok) {
      expect.unreachable('expected a refusal')
    }
    expect(output.error).toBe(ASSET_UNAVAILABLE_ERROR)
    expect(JSON.stringify(output)).not.toContain(DESCRIPTION_BODY)
  })

  it('fails closed when a referencing note cannot be read', async () => {
    const tools = buildNoteTools({
      readNoteFn: async (path) => {
        if (path === SIDECAR) {
          return `---\nreflectAsset: true\n---\n${DESCRIPTION_BODY}\n`
        }
        throw { kind: 'io', message: 'disk error' }
      },
      assetReferencingNotePathsFn: async () => ['notes/deck.md'],
    })
    const output = await runReadAsset(tools, ASSET)
    if (output.ok) {
      expect.unreachable('expected a refusal')
    }
    expect(output.error).toBe(ASSET_UNAVAILABLE_ERROR)
  })

  it('rejects a non-asset path without touching the filesystem', async () => {
    const reads: string[] = []
    const tools = buildNoteTools({
      readNoteFn: async (path) => {
        reads.push(path)
        throw { kind: 'notFound', message: 'no such file' }
      },
      assetReferencingNotePathsFn: async () => [],
    })
    for (const path of ['notes/secret.md', 'assets/chart.png.reflect.md']) {
      const output = await runReadAsset(tools, path)
      if (output.ok) {
        expect.unreachable('expected a refusal')
      }
      expect(output.error).toBe(NOT_AN_ASSET_ERROR)
    }
    expect(reads).toEqual([])
  })

  it('treats an empty sidecar body as no description', async () => {
    const tools = assetTools(
      { [SIDECAR]: '---\nreflectAsset: true\n---\n\n', 'notes/deck.md': PUBLIC_REF },
      ['notes/deck.md'],
    )
    const output = await runReadAsset(tools, ASSET)
    if (output.ok) {
      expect.unreachable('expected a miss')
    }
    expect(output.error).toBe(NO_ASSET_DESCRIPTION_ERROR)
  })

  it('answers unavailable, not no-description, for a blocked asset with an empty sidecar', async () => {
    const tools = assetTools(
      { [SIDECAR]: '---\nreflectAsset: true\n---\n\n', [PRIVATE_PATH]: PRIVATE_REF },
      [PRIVATE_PATH],
    )
    const output = await runReadAsset(tools, ASSET)
    if (output.ok) {
      expect.unreachable('expected a refusal')
    }
    expect(output.error).toBe(ASSET_UNAVAILABLE_ERROR)
  })

  it('caps an oversized description and flags the cut', async () => {
    const tools = assetTools(
      {
        [SIDECAR]: 'x'.repeat(MAX_ASSET_DESCRIPTION_CHARS + 10),
        'notes/deck.md': PUBLIC_REF,
      },
      ['notes/deck.md'],
    )
    const output = await runReadAsset(tools, ASSET)
    if (!output.ok) {
      expect.unreachable('expected a successful read')
    }
    expect(output.asset.description.length).toBe(MAX_ASSET_DESCRIPTION_CHARS)
    expect(output.asset.truncated).toBe(true)
  })
})

describe('list_recent_notes', () => {
  it('queries with the default limit and no tag', async () => {
    const seen: RecentNotesOptions[] = []
    const tools = buildNoteTools({
      listRecentNotesFn: async (options) => {
        seen.push(options)
        return []
      },
    })
    await runRecents(tools, {})
    expect(seen).toEqual([{ limit: 10, tag: null }])
  })

  it('passes an explicit limit and tag through', async () => {
    const seen: RecentNotesOptions[] = []
    const tools = buildNoteTools({
      listRecentNotesFn: async (options) => {
        seen.push(options)
        return []
      },
    })
    await runRecents(tools, { limit: 3, tag: 'book' })
    expect(seen).toEqual([{ limit: 3, tag: 'book' }])
  })

  it('treats an explicit null tag as no filter', async () => {
    const seen: RecentNotesOptions[] = []
    const tools = buildNoteTools({
      listRecentNotesFn: async (options) => {
        seen.push(options)
        return []
      },
    })
    await runRecents(tools, { tag: null })
    expect(seen).toEqual([{ limit: 10, tag: null }])
  })

  it('refuses a non-tag filter without querying, pointing at the no-tag call', async () => {
    const seen: RecentNotesOptions[] = []
    const tools = buildNoteTools({
      listRecentNotesFn: async (options) => {
        seen.push(options)
        return []
      },
    })
    for (const tag of ['*', ' ', '#book', ']INVALIDNOFILTER[']) {
      const output = await runRecents(tools, { tag })
      if (output.ok) {
        expect.unreachable('expected a refusal')
      }
      expect(output.tag).toBe(tag)
      expect(output.error).toBe(INVALID_TAG_ERROR)
    }
    expect(seen).toEqual([])
  })

  it('maps rows onto listings: preview as snippet, ISO modifiedAt, no daily date', async () => {
    const mtime = 1_750_000_000_000
    const tools = buildNoteTools({
      listRecentNotesFn: async () => [recentRow({ mtime })],
      readNoteFn: async () => 'a public body\n',
    })
    const output = await runRecents(tools, {})
    if (!output.ok) {
      expect.unreachable('expected a listing')
    }
    expect(output.notes).toEqual([
      {
        path: 'notes/public.md',
        title: 'Public note',
        dailyDate: null,
        snippet: 'a public preview',
        modifiedAt: new Date(mtime).toISOString(),
      },
    ])
  })

  it('drops an indexed-private row entirely — not even the title goes out', async () => {
    const tools = buildNoteTools({
      listRecentNotesFn: async () => [
        recentRow({}),
        recentRow({ path: PRIVATE_PATH, title: PRIVATE_TITLE, isPrivate: true }),
      ],
      readNoteFn: async () => 'a public body\n',
    })
    const output = await runRecents(tools, {})
    const payload = JSON.stringify(output)
    expect(payload).not.toContain(PRIVATE_TITLE)
    expect(payload).not.toContain(PRIVATE_PATH)
    if (!output.ok) {
      expect.unreachable('expected a listing')
    }
    expect(output.notes).toHaveLength(1)
  })

  it('drops a row whose live frontmatter turned private before reindex (TOCTOU)', async () => {
    const tools = buildNoteTools({
      listRecentNotesFn: async () => [recentRow({ path: PRIVATE_PATH, title: PRIVATE_TITLE })],
      readNoteFn: async () => '---\nprivate: true\n---\n# Diary\n',
    })
    const output = await runRecents(tools, {})
    if (!output.ok) {
      expect.unreachable('expected a listing')
    }
    expect(output.notes).toEqual([])
    expect(JSON.stringify(output)).not.toContain(PRIVATE_TITLE)
  })

  it('fails closed: an unreadable row is dropped, not sent', async () => {
    const tools = buildNoteTools({
      listRecentNotesFn: async () => [recentRow({})],
      readNoteFn: async () => {
        throw { kind: 'io', message: 'disk error' }
      },
    })
    const output = await runRecents(tools, {})
    if (!output.ok) {
      expect.unreachable('expected a listing')
    }
    expect(output.notes).toEqual([])
  })
})

describe('list_daily_notes', () => {
  it('queries the inclusive range with one row past the day cap', async () => {
    const seen: DailyNotesRange[] = []
    const tools = buildNoteTools({
      listDailyNotesFn: async (range) => {
        seen.push(range)
        return []
      },
    })
    await runDailies(tools, { start: '2026-06-01', end: '2026-06-30' })
    expect(seen).toEqual([
      { start: '2026-06-01', end: '2026-06-30', limit: MAX_DAILY_NOTE_DAYS + 1 },
    ])
  })

  it('maps days with their dates and stays untruncated within the cap', async () => {
    const tools = buildNoteTools({
      listDailyNotesFn: async () => [dailyRow('2026-06-10'), dailyRow('2026-06-09')],
      readNoteFn: async () => 'a public body\n',
    })
    const output = await runDailies(tools, { start: '2026-06-01', end: '2026-06-30' })
    expect(output.truncated).toBe(false)
    expect(output.days.map((day) => day.dailyDate)).toEqual(['2026-06-10', '2026-06-09'])
    expect(output.days[0]?.path).toBe('daily/2026-06-10.md')
  })

  it('cuts an over-cap range to the cap and flags the truncation', async () => {
    const days = Array.from({ length: MAX_DAILY_NOTE_DAYS + 1 }, (_, index) =>
      dailyRow(`2026-05-${String(index + 1).padStart(2, '0')}`),
    )
    const tools = buildNoteTools({
      listDailyNotesFn: async () => days,
      readNoteFn: async () => 'a public body\n',
    })
    const output = await runDailies(tools, { start: '2026-05-01', end: '2026-06-30' })
    expect(output.truncated).toBe(true)
    expect(output.days).toHaveLength(MAX_DAILY_NOTE_DAYS)
  })

  it('drops a daily whose live frontmatter turned private before reindex (TOCTOU)', async () => {
    const tools = buildNoteTools({
      listDailyNotesFn: async () => [
        dailyRow('2026-06-10', { path: PRIVATE_PATH, title: PRIVATE_TITLE }),
      ],
      readNoteFn: async () => '---\nprivate: true\n---\n# Diary\n',
    })
    const output = await runDailies(tools, { start: '2026-06-01', end: '2026-06-30' })
    expect(output.days).toEqual([])
    expect(JSON.stringify(output)).not.toContain(PRIVATE_TITLE)
  })
})

describe('list_collection', () => {
  it('refuses a tag the grammar can never produce', async () => {
    const tools = buildNoteTools({})
    const output = await runCollection(tools, { tag: '*' })
    expect(output).toEqual({ ok: false, tag: '*', error: INVALID_COLLECTION_TAG_ERROR })
  })

  it('refuses a tag without a type instead of returning misleading rows', async () => {
    const tools = buildNoteTools({
      getTagTypeFn: async () => null,
    })
    const output = await runCollection(tools, { tag: 'book' })
    expect(output).toEqual({ ok: false, tag: 'book', error: UNTYPED_TAG_ERROR })
  })

  it('returns the schema and rows with typed property values', async () => {
    const tools = buildNoteTools({
      getTagTypeFn: async () => BOOK_TYPE,
      listCollectionFn: async () => [collectionRow({})],
      readNoteFn: async () => 'a public body\n',
    })
    const output = await runCollection(tools, { tag: 'book' })
    if (!output.ok) {
      throw new Error(`unexpected refusal: ${output.error}`)
    }
    expect(output.schema).toEqual(BOOK_TYPE.properties)
    expect(output.truncated).toBe(false)
    expect(output.rows).toEqual([
      {
        path: 'notes/public.md',
        title: 'Public note',
        modifiedAt: new Date(1_750_000_000_000).toISOString(),
        // Round-tripped to typed YAML values, not raw index rows.
        properties: { author: 'Le Guin', rating: 4.5 },
      },
    ])
  })

  it('asks SQL to prefilter private rows and drops leftovers entirely', async () => {
    const seenOptions: Array<unknown> = []
    const tools = buildNoteTools({
      getTagTypeFn: async () => BOOK_TYPE,
      // A private row that slipped past the SQL prefilter (stale index) —
      // the live gate must still drop it whole: title, path, and values.
      listCollectionFn: async (_tag, _sort, options) => {
        seenOptions.push(options)
        return [
          collectionRow({}),
          collectionRow({
            path: PRIVATE_PATH,
            title: PRIVATE_TITLE,
            properties: {
              author: { value: PRIVATE_BODY, valueType: 'string', valueNumber: null },
            },
          }),
        ]
      },
      readNoteFn: async (path) =>
        path === PRIVATE_PATH ? '---\nprivate: true\n---\n# Diary\n' : 'a public body\n',
    })
    const output = await runCollection(tools, { tag: 'book' })
    expect(seenOptions).toEqual([{ excludePrivate: true, limit: 31 }])
    const payload = JSON.stringify(output)
    expect(payload).not.toContain(PRIVATE_TITLE)
    expect(payload).not.toContain(PRIVATE_PATH)
    expect(payload).not.toContain(PRIVATE_BODY)
    if (!output.ok) {
      throw new Error(`unexpected refusal: ${output.error}`)
    }
    expect(output.rows).toHaveLength(1)
  })

  it('drops a row whose live frontmatter turned private before reindex (TOCTOU)', async () => {
    const tools = buildNoteTools({
      getTagTypeFn: async () => BOOK_TYPE,
      // The stale index still says public…
      listCollectionFn: async () => [collectionRow({ path: PRIVATE_PATH, title: PRIVATE_TITLE })],
      // …but the note on disk was just marked private.
      readNoteFn: async () => '---\nprivate: true\n---\n# Diary\n',
    })
    const output = await runCollection(tools, { tag: 'book' })
    if (!output.ok) {
      throw new Error(`unexpected refusal: ${output.error}`)
    }
    expect(output.rows).toEqual([])
    expect(JSON.stringify(output)).not.toContain(PRIVATE_TITLE)
  })

  it('passes the sort through and reports truncation past the limit', async () => {
    const seenSorts: Array<unknown> = []
    const rows = Array.from({ length: 3 }, (_, index) =>
      collectionRow({ path: `notes/book-${index}.md`, title: `Book ${index}` }),
    )
    const tools = buildNoteTools({
      getTagTypeFn: async () => BOOK_TYPE,
      listCollectionFn: async (_tag, sort) => {
        seenSorts.push(sort)
        return rows
      },
      readNoteFn: async () => 'a public body\n',
    })
    const output = await runCollection(tools, { tag: 'book', sortBy: 'rating', limit: 2 })
    expect(seenSorts).toEqual([[{ key: 'rating', direction: 'asc' }]])
    if (!output.ok) {
      throw new Error(`unexpected refusal: ${output.error}`)
    }
    expect(output.truncated).toBe(true)
    expect(output.rows).toHaveLength(2)
  })
})

describe('set_note_property', () => {
  /** Execute `set_note_property` directly, asserting a non-streaming output. */
  async function runSetProperty(
    tools: NoteTools,
    input: { path: string; key: string; value?: unknown; clear?: boolean },
  ): Promise<SetNotePropertyOutput> {
    const execute = tools.set_note_property.execute
    if (!execute) {
      throw new Error('set_note_property has no execute')
    }
    const output = await execute(input as never, CALL)
    if (isAsyncIterable(output)) {
      throw new Error('unexpected streaming tool output')
    }
    return output
  }

  it('refuses when edits are disabled', async () => {
    const tools = buildNoteTools({})
    const output = await runSetProperty(tools, {
      path: 'notes/a.md',
      key: 'status',
      value: 'done',
    })
    expect(output).toEqual({ ok: false, path: 'notes/a.md', error: EDITS_DISABLED_ERROR })
  })

  it('refuses reserved or invalid keys', async () => {
    const tools = buildNoteTools({ allowEdits: true })
    const output = await runSetProperty(tools, { path: 'notes/a.md', key: 'private', value: true })
    expect(output).toEqual({ ok: false, path: 'notes/a.md', error: RESERVED_PROPERTY_ERROR })
  })

  it('refuses private notes on the live frontmatter, failing closed', async () => {
    const tools = buildNoteTools({
      allowEdits: true,
      readNoteFn: async () => '---\nprivate: true\n---\n# Diary\n',
    })
    const output = await runSetProperty(tools, {
      path: PRIVATE_PATH,
      key: 'status',
      value: 'done',
    })
    expect(output).toEqual({ ok: false, path: PRIVATE_PATH, error: PRIVATE_NOTE_EDIT_ERROR })
  })

  it('proposes the typed value without writing, and clears as null', async () => {
    const tools = buildNoteTools({
      allowEdits: true,
      readNoteFn: async () => 'a public body\n',
    })
    expect(await runSetProperty(tools, { path: 'notes/a.md', key: 'rating', value: 4.5 })).toEqual({
      ok: true,
      path: 'notes/a.md',
      key: 'rating',
      value: 4.5,
    })
    expect(await runSetProperty(tools, { path: 'notes/a.md', key: 'rating', clear: true })).toEqual(
      {
        ok: true,
        path: 'notes/a.md',
        key: 'rating',
        value: null,
      },
    )
    expect(await runSetProperty(tools, { path: 'notes/a.md', key: 'rating' })).toEqual({
      ok: false,
      path: 'notes/a.md',
      error: MISSING_VALUE_ERROR,
    })
  })

  it('formats proposed values for the apply chip', () => {
    expect(formatPropertyPreview(null)).toBe('cleared')
    expect(formatPropertyPreview(4.5)).toBe('4.5')
    expect(formatPropertyPreview(true)).toBe('true')
    expect(formatPropertyPreview(['sci-fi', 'novel'])).toBe('sci-fi, novel')
  })

  it('maps a successful proposal onto the chip result, including a clear', () => {
    expect(
      noteToolResult({
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'set_note_property',
        input: { path: 'notes/a.md', key: 'rating', value: 4.5 },
        output: { ok: true, path: 'notes/a.md', key: 'rating', value: 4.5 },
      } as never),
    ).toEqual({
      tool: 'setProperty',
      toolCallId: 'c1',
      path: 'notes/a.md',
      key: 'rating',
      error: null,
      value: 4.5,
    })
    expect(
      noteToolResult({
        type: 'tool-result',
        toolCallId: 'c2',
        toolName: 'set_note_property',
        input: { path: 'notes/a.md', key: 'rating', clear: true },
        output: { ok: true, path: 'notes/a.md', key: 'rating', value: null },
      } as never),
    ).toEqual({
      tool: 'setProperty',
      toolCallId: 'c2',
      path: 'notes/a.md',
      key: 'rating',
      error: null,
      value: null,
    })
  })

  it('maps a refused property edit onto an error chip with no value', () => {
    expect(
      noteToolResult({
        type: 'tool-result',
        toolCallId: 'c3',
        toolName: 'set_note_property',
        input: { path: 'notes/a.md', key: 'private', value: true },
        output: { ok: false, path: 'notes/a.md', error: RESERVED_PROPERTY_ERROR },
      } as never),
    ).toEqual({
      tool: 'setProperty',
      toolCallId: 'c3',
      path: 'notes/a.md',
      key: 'private',
      error: RESERVED_PROPERTY_ERROR,
      value: null,
    })
  })
})
