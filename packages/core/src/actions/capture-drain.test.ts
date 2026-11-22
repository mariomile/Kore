import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addSpool,
  CAPTURED_AT,
  DAILY,
  describeMock,
  drain,
  envelope,
  downloadOnRequest,
  evicted,
  files,
  IDENTITY,
  inboxRemoveMock,
  promoteMock,
  readNoteMock,
  rejected,
  requestDownloadsMock,
  scrapeMock,
  spool,
  wireCaptureMocks,
  writeNoteMock,
} from './capture-harness'
import type { FileCaptureEnvelope, TextCaptureEnvelope } from './capture-envelope'
import { blockContextAt } from '../indexing/block-context'

const ensureBacklinkTargetMock = vi.hoisted(() => vi.fn())
const importSpoolMock = vi.hoisted(() => vi.fn())
const importImageMock = vi.hoisted(() => vi.fn())
const xPostMock = vi.hoisted(() => vi.fn())

vi.mock('../graph/commands', () => ({
  createNoteIfAbsent: vi.fn(),
  captureInboxList: vi.fn(),
  captureInboxRead: vi.fn(),
  captureInboxReject: vi.fn(),
  captureInboxRemove: vi.fn(),
  captureLinkPreview: vi.fn(),
  listFiles: vi.fn(),
  promoteCaptureScreenshot: vi.fn(),
  readAsset: vi.fn(),
  readNote: vi.fn(),
  readNoteLocal: vi.fn(),
  writeAsset: vi.fn(),
  writeNote: vi.fn(),
}))
vi.mock('../ipc/commands', () => ({
  icloudRequestDownloads: vi.fn(),
}))
vi.mock('./meta-scrape', () => ({
  scrapePageMeta: vi.fn(),
}))
vi.mock('../ai/describe-page', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/describe-page')>()),
  describePage: vi.fn(),
}))
vi.mock('../secrets/keychain', () => ({
  getSecret: vi.fn(),
}))
vi.mock('./backlink-target', () => ({
  ensureBacklinkTarget: ensureBacklinkTargetMock,
}))
vi.mock('../graph/assets', () => ({
  importCaptureSpool: importSpoolMock,
  importRemoteImage: importImageMock,
}))
vi.mock('./post-embed', () => ({
  resolveXPostEmbed: xPostMock,
}))

beforeEach(() => {
  wireCaptureMocks()
  ensureBacklinkTargetMock.mockImplementation((title: string) => Promise.resolve(title))
  xPostMock.mockResolvedValue(undefined)
  // The vault's attachment folder: the spooled copy lands under its
  // desired name, `-2` on a collision, as Rust's `persist_unique` does.
  importImageMock.mockImplementation((_url: string, name: string) =>
    Promise.resolve(`assets/${name}`),
  )
  importSpoolMock.mockImplementation(async (spoolName: string, desiredName: string) => {
    const entry = spool.get(spoolName)
    if (entry === undefined) throw { kind: 'notFound', message: 'missing' }
    const dot = desiredName.lastIndexOf('.')
    let path = `assets/${desiredName}`
    for (let attempt = 2; files.has(path); attempt += 1) {
      path = `assets/${desiredName.slice(0, dot)}-${attempt}${desiredName.slice(dot)}`
    }
    files.set(path, entry.contents)
    return path
  })
})

describe('drainCaptureInbox', () => {
  it('drains valid captures even when an unsupported resource URL cannot be collected', async () => {
    addSpool(envelope({ url: 'https://user:secret@example.com/', title: 'Credential URL' }), {
      screenshot: false,
      modifiedMs: 100,
    })
    addSpool(envelope({ id: '00000000-0000-4000-8000-000000000002', title: 'Next capture' }), {
      screenshot: false,
      modifiedMs: 200,
    })

    const outcome = await drain()

    expect(outcome.drained).toBe(2)
    expect(outcome.stopped).toBeNull()
    expect(outcome.collectionFailures).toHaveLength(1)
    expect(outcome.collectionFailures?.[0]?.message).toBe('Only HTTP(S) links can be collected')
    expect(files.get(IDENTITY.notePath)).toContain('captureUrl: https://user:secret@example.com/')
    expect(files.get(DAILY)).toContain('|Credential URL]]')
    expect(files.get(DAILY)).toContain('|Next capture]]')
    expect([...files.values()].some((source) => source.includes('#link\n'))).toBe(true)
    expect(spool.size).toBe(0)
  })

  it('writes the capture note, daily entry, and asset — then removes the spool', async () => {
    addSpool(envelope({ selection: 'quoted text', note: 'check later' }))

    const outcome = await drain()

    expect(outcome).toEqual({ pending: 1, drained: 1, deduped: 0, invalid: 0, stopped: null })
    expect(promoteMock).toHaveBeenCalledWith(
      '7c9e6679-7425-40de-944b-e07fc1f90ae7.jpg',
      IDENTITY.assetPath,
      1600,
      3,
    )
    const note = files.get(IDENTITY.notePath)
    expect(note).toContain('captureUrl: https://example.com/article')
    expect(note).toContain('captureStatus: pending')
    expect(note).toContain('captureScreenshot: assets/capture-2026-06-11-153022-845-7c9e.jpg')
    expect(note).toContain('# An article')
    expect(note).toContain('- URL: https://example.com/article')
    expect(note).toContain('- Type: #capture')
    expect(note).not.toContain('Highlights')
    expect(note).toContain('## Note\n\ncheck later')
    expect(note).toContain('## Selection\n\nquoted text')
    expect(note).toContain(`## Screenshot\n\n![An article](${IDENTITY.assetPath})`)

    const daily = files.get(DAILY)
    expect(daily).toContain('## [[Links]]')
    expect(daily).toContain('- [[capture-2026-06-11-153022-845-7c9e|An article]]')
    expect(ensureBacklinkTargetMock).toHaveBeenCalledWith('Links', 3)
    expect(spool.size).toBe(0)
  })

  it('writes extracted page text into the capture note', async () => {
    addSpool(envelope({ contentText: 'First paragraph.\n\nSecond paragraph.' }), {
      screenshot: false,
    })

    const outcome = await drain()

    expect(outcome).toEqual({ pending: 1, drained: 1, deduped: 0, invalid: 0, stopped: null })
    const note = files.get(IDENTITY.notePath)
    expect(note).toContain(
      '## Page Text\n\n<!-- reflect-capture-page-text:start -->\nFirst paragraph.\n\nSecond paragraph.\n<!-- reflect-capture-page-text:end -->',
    )
  })

  it('writes an iOS share capture with its in-page description into the raw save', async () => {
    addSpool(envelope({ source: 'ios-share', metaDescription: '  A page\nabout examples.  ' }), {
      screenshot: false,
    })

    const outcome = await drain()

    expect(outcome).toEqual({ pending: 1, drained: 1, deduped: 0, invalid: 0, stopped: null })
    const note = files.get(IDENTITY.notePath)
    expect(note).toContain('captureSource: ios-share')
    // Whitespace-folded onto the one metadata line, right where enrichment
    // will replace it in place.
    expect(note).toContain('- Type: #capture\n- Description: A page about examples.')
    expect(note).toContain('captureStatus: pending')
  })

  it('removes the spool only after the note and daily entry are written', async () => {
    addSpool(envelope())
    await drain()
    const lastWrite = Math.max(...writeNoteMock.mock.invocationCallOrder)
    const firstRemove = Math.min(...inboxRemoveMock.mock.invocationCallOrder)
    expect(firstRemove).toBeGreaterThan(lastWrite)
  })

  it('drains a batch that arrived while the app was closed, oldest first', async () => {
    addSpool(envelope({ id: '00000000-0000-4000-8000-000000000002', url: 'https://b.com' }), {
      modifiedMs: 200,
    })
    addSpool(
      envelope({
        id: '00000000-0000-4000-8000-000000000001',
        url: 'https://a.com',
        capturedAt: new Date(2026, 5, 11, 9, 0, 0, 0).toISOString(),
      }),
      { modifiedMs: 100 },
    )

    const outcome = await drain()

    expect(outcome.drained).toBe(2)
    const daily = files.get(DAILY) ?? ''
    expect(daily.indexOf('capture-2026-06-11-090000-000')).toBeLessThan(
      daily.indexOf('capture-2026-06-11-153022-845'),
    )
    expect(spool.size).toBe(0)
  })

  it('upgrades the existing plain Links section without duplicating it', async () => {
    files.set(DAILY, '# plans\n\n## Links\n\n[[capture-2026-06-11-090000-000-0000|Old]]\n')
    addSpool(envelope())

    await drain()

    const daily = files.get(DAILY) ?? ''
    expect(daily.match(/## \[\[Links\]\]/g)).toHaveLength(1)
    expect(daily).not.toContain('## Links\n')
    expect(daily).toContain('[[capture-2026-06-11-090000-000-0000|Old]]')
    expect(daily).toContain(
      '## [[Links]]\n\n- [[capture-2026-06-11-153022-845-7c9e|An article]]\n\n[[capture-2026-06-11-090000-000-0000|Old]]',
    )
  })

  it('extends only the leading Links list, before later daily-note prose', async () => {
    files.set(DAILY, '## [[Links]]\n\n- [[Old]]\n- [[Older]]\n\nScratchpad for later.\n')
    addSpool(envelope())

    await drain()

    expect(files.get(DAILY)).toBe(
      '## [[Links]]\n\n- [[Old]]\n- [[Older]]\n- [[capture-2026-06-11-153022-845-7c9e|An article]]\n\nScratchpad for later.\n',
    )
  })

  it('reuses an existing linked Links section for same-day dedup', async () => {
    addSpool(
      envelope({
        id: '00000000-0000-4000-8000-000000000001',
        capturedAt: new Date(2026, 5, 11, 9, 30, 0, 0).toISOString(),
      }),
    )
    await drain()

    addSpool(envelope())
    const outcome = await drain()

    expect(outcome.deduped).toBe(1)
    const daily = files.get(DAILY) ?? ''
    expect(daily.match(/## \[\[Links\]\]/g)).toHaveLength(1)
    expect(daily.match(/capture-2026-06-11-093000-000-0000/g)).toHaveLength(1)
  })

  it('does not treat a nested Links heading as the daily capture section', async () => {
    addSpool(
      envelope({
        id: '00000000-0000-4000-8000-000000000001',
        capturedAt: new Date(2026, 5, 11, 9, 30, 0, 0).toISOString(),
      }),
    )
    await drain()
    files.set(DAILY, '> ## [[Links]]\n>\n> - [[capture-2026-06-11-093000-000-0000|An article]]\n')

    addSpool(envelope())
    const outcome = await drain()

    expect(outcome.deduped).toBe(0)
    expect(files.has(IDENTITY.notePath)).toBe(true)
    expect(files.get(DAILY)).toContain(
      '\n## [[Links]]\n\n- [[capture-2026-06-11-153022-845-7c9e|An article]]\n',
    )
  })

  it('upgrades a legacy heading even when a same-day recapture is deduplicated', async () => {
    addSpool(
      envelope({
        id: '00000000-0000-4000-8000-000000000001',
        capturedAt: new Date(2026, 5, 11, 9, 30, 0, 0).toISOString(),
      }),
    )
    await drain()
    files.set(DAILY, (files.get(DAILY) ?? '').replace('## [[Links]]', '## Links'))

    addSpool(envelope())
    const outcome = await drain()

    expect(outcome.deduped).toBe(1)
    expect(files.get(DAILY)).toContain('## [[Links]]')
    expect(files.get(DAILY)).not.toContain('## Links\n')
  })

  it('deduplicates across every matching Links section', async () => {
    addSpool(
      envelope({
        id: '00000000-0000-4000-8000-000000000001',
        capturedAt: new Date(2026, 5, 11, 9, 30, 0, 0).toISOString(),
      }),
    )
    await drain()
    files.set(DAILY, `## Links\n\n- [[Old]]\n\n${files.get(DAILY) ?? ''}`)

    addSpool(envelope())
    const outcome = await drain()

    expect(outcome.deduped).toBe(1)
    expect(files.has(IDENTITY.notePath)).toBe(false)
  })

  it('keeps the spool retryable when the Links note cannot be ensured', async () => {
    addSpool(envelope())
    ensureBacklinkTargetMock.mockRejectedValue({ kind: 'io', message: 'disk full' })

    const outcome = await drain()

    expect(outcome.stopped).toEqual({ reason: 'io', message: 'disk full' })
    expect(files.size).toBe(0)
    expect(spool.size).toBe(2)
  })

  it('uses the current title when the Links note was renamed', async () => {
    ensureBacklinkTargetMock.mockResolvedValue('Bookmarks')
    addSpool(envelope())

    await drain()

    expect(files.get(DAILY)).toContain('## [[Bookmarks]]')
    expect(files.get(DAILY)).not.toContain('## [[Links]]')
    expect(ensureBacklinkTargetMock).toHaveBeenCalledWith('Links', 3)
  })

  it('deduplicates captures under a renamed Links heading', async () => {
    addSpool(
      envelope({
        id: '00000000-0000-4000-8000-000000000001',
        capturedAt: new Date(2026, 5, 11, 9, 30, 0, 0).toISOString(),
      }),
    )
    await drain()
    files.set(DAILY, (files.get(DAILY) ?? '').replace('[[Links]]', '[[Bookmarks]]'))
    ensureBacklinkTargetMock.mockResolvedValue('Bookmarks')

    addSpool(envelope())
    const outcome = await drain()

    expect(outcome.deduped).toBe(1)
    expect(files.has(IDENTITY.notePath)).toBe(false)
    expect(files.get(DAILY)).toContain('## [[Bookmarks]]')
  })

  it('saves a private-day capture raw, marked skipped', async () => {
    files.set(DAILY, '---\nprivate: true\n---\n\nsecret plans\n')
    addSpool(envelope())

    const outcome = await drain()

    expect(outcome.drained).toBe(1)
    expect(files.get(IDENTITY.notePath)).toContain('captureStatus: skipped')
    expect(files.get(DAILY)).toContain('- [[capture-2026-06-11-153022-845-7c9e|An article]]')
  })

  it('refreshes a same-day same-URL same-selection re-capture in place', async () => {
    addSpool(
      envelope({
        id: '00000000-0000-4000-8000-000000000001',
        capturedAt: new Date(2026, 5, 11, 9, 30, 0, 0).toISOString(),
      }),
    )
    await drain()
    const originalNotePath = 'notes/capture-2026-06-11-093000-000-0000.md'
    expect(files.has(originalNotePath)).toBe(true)

    addSpool(envelope()) // same URL, no selection, same day, 15:30
    const outcome = await drain()

    expect(outcome).toEqual({ pending: 1, drained: 1, deduped: 1, invalid: 0, stopped: null })
    // The existing identity is reused — no orphan note under the new stamp.
    expect(files.has(IDENTITY.notePath)).toBe(false)
    expect(files.get(originalNotePath)).toContain('captureStatus: pending')
    expect(promoteMock).toHaveBeenLastCalledWith(
      '7c9e6679-7425-40de-944b-e07fc1f90ae7.jpg',
      'assets/capture-2026-06-11-093000-000-0000.jpg',
      1600,
      3,
    )
    const daily = files.get(DAILY) ?? ''
    expect(daily.match(/capture-2026-06-11-093000-000-0000/g)).toHaveLength(1)
    expect(daily).not.toContain('capture-2026-06-11-153022-845')
  })

  it('a dedup refresh re-syncs the daily link text with the fresh tab title', async () => {
    addSpool(
      envelope({
        id: '00000000-0000-4000-8000-000000000001',
        capturedAt: new Date(2026, 5, 11, 9, 30, 0, 0).toISOString(),
      }),
    )
    await drain()
    // Simulate a completed enrichment: H1 and daily link text carry the AI title.
    const notePath = 'notes/capture-2026-06-11-093000-000-0000.md'
    files.set(notePath, (files.get(notePath) ?? '').replace('# An article', '# AI Title'))
    files.set(DAILY, (files.get(DAILY) ?? '').replace('|An article]]', '|AI Title]]'))

    addSpool(envelope()) // same URL re-capture, 15:30
    const outcome = await drain()

    expect(outcome.deduped).toBe(1)
    expect(files.get(notePath)).toContain('# An article')
    const daily = files.get(DAILY) ?? ''
    expect(daily).toContain('|An article]]')
    expect(daily).not.toContain('|AI Title]]')
  })

  it('a dedup refresh leaves a user-edited daily link text alone', async () => {
    addSpool(
      envelope({
        id: '00000000-0000-4000-8000-000000000001',
        capturedAt: new Date(2026, 5, 11, 9, 30, 0, 0).toISOString(),
      }),
    )
    await drain()
    files.set(DAILY, (files.get(DAILY) ?? '').replace('|An article]]', '|my own link text]]'))

    addSpool(envelope({ title: 'An article - Example News' }))
    const outcome = await drain()

    expect(outcome.deduped).toBe(1)
    expect(files.get('notes/capture-2026-06-11-093000-000-0000.md')).toContain(
      '# An article - Example News',
    )
    expect(files.get(DAILY)).toContain('|my own link text]]')
  })

  it('a different selection creates a new entry instead of refreshing', async () => {
    addSpool(
      envelope({
        id: '00000000-0000-4000-8000-000000000001',
        capturedAt: new Date(2026, 5, 11, 9, 30, 0, 0).toISOString(),
      }),
    )
    await drain()

    addSpool(envelope({ selection: 'a fresh highlight' }))
    const outcome = await drain()

    expect(outcome.deduped).toBe(0)
    expect(files.has(IDENTITY.notePath)).toBe(true)
    const daily = files.get(DAILY) ?? ''
    expect(daily).toContain('capture-2026-06-11-093000-000')
    expect(daily).toContain('capture-2026-06-11-153022-845')
  })

  it('re-drains idempotently after a crash between note write and spool removal', async () => {
    addSpool(envelope())
    await drain()
    // Simulate the crashed pass: the spool files are back (never removed).
    addSpool(envelope())

    const outcome = await drain()

    expect(outcome).toEqual({ pending: 1, drained: 1, deduped: 1, invalid: 0, stopped: null })
    const daily = files.get(DAILY) ?? ''
    expect(daily.match(/capture-2026-06-11-153022-845/g)).toHaveLength(1)
  })

  it('quarantines an unparseable spool file instead of wedging the queue or deleting it', async () => {
    spool.set('garbage.json', { contents: 'not json', modifiedMs: 0 })
    addSpool(envelope({ id: '00000000-0000-4000-8000-000000000001' }))

    const outcome = await drain()

    expect(outcome.invalid).toBe(1)
    expect(outcome.drained).toBe(1)
    expect(spool.has('garbage.json')).toBe(false)
    // Moved, never deleted — a newer extension's envelope must survive an
    // older app that can't parse it yet.
    expect(rejected.get('garbage.json')).toBe('not json')
    expect(inboxRemoveMock).not.toHaveBeenCalledWith('garbage.json', 3)
    expect(writeNoteMock).toHaveBeenCalled()
  })

  it('drains two same-millisecond captures of different pages into distinct notes', async () => {
    addSpool(envelope({ id: '00000000-0000-4000-8000-000000000001', url: 'https://a.com' }), {
      screenshot: false,
    })
    addSpool(envelope({ id: 'ffff0000-0000-4000-8000-000000000002', url: 'https://b.com' }), {
      screenshot: false,
    })

    const outcome = await drain()

    expect(outcome.drained).toBe(2)
    expect(files.has('notes/capture-2026-06-11-153022-845-0000.md')).toBe(true)
    expect(files.has('notes/capture-2026-06-11-153022-845-ffff.md')).toBe(true)
  })

  it('saves a capture whose screenshot cannot decode, without wedging the pass', async () => {
    addSpool(envelope())
    promoteMock.mockRejectedValue({ kind: 'parse', message: 'screenshot does not decode' })

    const outcome = await drain()

    // Retrying identical bytes can't help — the capture lands without its
    // image instead of permanently blocking every capture behind it.
    expect(outcome).toEqual({ pending: 1, drained: 1, deduped: 0, invalid: 0, stopped: null })
    const note = files.get(IDENTITY.notePath) ?? ''
    expect(note).not.toContain('![')
    expect(note).not.toContain('captureScreenshot')
    expect(spool.size).toBe(0)
  })

  it('saves a capture whose screenshot sibling never landed, without the image', async () => {
    addSpool(envelope())
    spool.delete('7c9e6679-7425-40de-944b-e07fc1f90ae7.jpg')

    const outcome = await drain()

    expect(outcome.drained).toBe(1)
    const note = files.get(IDENTITY.notePath) ?? ''
    expect(note).not.toContain('![')
    expect(note).not.toContain('captureScreenshot')
  })

  it('sweeps old orphan screenshots but never young ones', async () => {
    spool.set('11111111-1111-4111-8111-111111111111.jpg', { contents: 'x', modifiedMs: 0 })
    spool.set('22222222-2222-4222-8222-222222222222.jpg', {
      contents: 'x',
      modifiedMs: 9_000_000,
    })

    await drain({ now: () => 10_000_000 }) // first is ~2.8h old, second ~17min

    expect(spool.has('11111111-1111-4111-8111-111111111111.jpg')).toBe(false)
    expect(spool.has('22222222-2222-4222-8222-222222222222.jpg')).toBe(true)
  })

  it('stops before any work when the session is stale', async () => {
    addSpool(envelope())
    const outcome = await drain({ isStale: () => true })
    expect(outcome.stopped?.reason).toBe('stale')
    expect(writeNoteMock).not.toHaveBeenCalled()
    expect(spool.size).toBe(2)
  })

  it('a write failure stops the pass with the error kind', async () => {
    addSpool(envelope())
    writeNoteMock.mockRejectedValue({ kind: 'io', message: 'disk full' })

    const outcome = await drain()

    expect(outcome.stopped).toEqual({ reason: 'io', message: 'disk full' })
    expect(spool.size).toBe(2) // nothing removed — the capture is retryable
  })
})

describe('drainCaptureInbox (text captures)', () => {
  function textEnvelope(overrides: Partial<TextCaptureEnvelope> = {}): TextCaptureEnvelope {
    return {
      version: 1,
      id: 'a1b2c3d4-0000-4000-8000-000000000001',
      kind: 'append',
      text: 'call the bank',
      capturedAt: CAPTURED_AT.toISOString(),
      source: 'deep-link',
      ...overrides,
    }
  }

  function addTextSpool(capture: TextCaptureEnvelope): void {
    spool.set(`${capture.id}.json`, { contents: JSON.stringify(capture), modifiedMs: 0 })
  }

  it('appends a bullet to the capture-day daily and removes the spool', async () => {
    addTextSpool(textEnvelope())

    const outcome = await drain()

    expect(outcome).toEqual({ pending: 1, drained: 1, deduped: 0, invalid: 0, stopped: null })
    expect(files.get(DAILY)).toBe('- call the bank\n')
    expect(spool.size).toBe(0)
  })

  it('appends a task envelope as a round (+) task the Tasks view projects', async () => {
    addTextSpool(textEnvelope({ kind: 'task', text: 'buy milk' }))

    await drain()

    expect(files.get(DAILY)).toBe('+ [ ] buy milk\n')
  })

  it('appends a checkbox envelope as a square GFM checkbox', async () => {
    addTextSpool(textEnvelope({ kind: 'checkbox', text: 'pack a bag' }))

    await drain()

    expect(files.get(DAILY)).toBe('- [ ] pack a bag\n')
  })

  it('joins the daily note’s trailing bullet list instead of opening a new block', async () => {
    files.set(DAILY, '- morning standup\n')
    addTextSpool(textEnvelope())

    await drain()

    expect(files.get(DAILY)).toBe('- morning standup\n- call the bank\n')
  })

  it('two same-day captures grow one list', async () => {
    addTextSpool(textEnvelope())
    spool.set('a1b2c3d4-0000-4000-8000-000000000002.json', {
      contents: JSON.stringify(
        textEnvelope({ id: 'a1b2c3d4-0000-4000-8000-000000000002', text: 'buy milk' }),
      ),
      modifiedMs: 1,
    })

    const outcome = await drain()

    expect(outcome).toEqual({ pending: 2, drained: 2, deduped: 0, invalid: 0, stopped: null })
    expect(files.get(DAILY)).toBe('- call the bank\n- buy milk\n')
  })

  it('starts a fresh list after a prose tail', async () => {
    files.set(DAILY, 'Wrote some prose.\n')
    addTextSpool(textEnvelope())

    await drain()

    expect(files.get(DAILY)).toBe('Wrote some prose.\n\n- call the bank\n')
  })

  it('joins a CRLF daily with CRLF line endings', async () => {
    files.set(DAILY, '- morning standup\r\n')
    addTextSpool(textEnvelope())

    await drain()

    expect(files.get(DAILY)).toBe('- morning standup\r\n- call the bank\r\n')
  })

  it('appends a duplicate line — identical text twice is two entries', async () => {
    files.set(DAILY, '- call the bank\n')
    addTextSpool(textEnvelope())

    const outcome = await drain()

    expect(outcome).toEqual({ pending: 1, drained: 1, deduped: 0, invalid: 0, stopped: null })
    expect(files.get(DAILY)).toBe('- call the bank\n- call the bank\n')
    expect(spool.size).toBe(0)
  })

  it('drains an ios-intent envelope like any other text source', async () => {
    addTextSpool(textEnvelope({ source: 'ios-intent' }))

    const outcome = await drain()

    expect(outcome).toEqual({ pending: 1, drained: 1, deduped: 0, invalid: 0, stopped: null })
    expect(files.get(DAILY)).toBe('- call the bank\n')
  })

  it('a checkbox never joins a task list — the + marker stays a task', async () => {
    files.set(DAILY, '+ [ ] buy milk\n')
    addTextSpool(textEnvelope({ kind: 'checkbox', text: 'pack a bag' }))

    await drain()

    expect(files.get(DAILY)).toBe('+ [ ] buy milk\n\n- [ ] pack a bag\n')
  })

  it('still appends to a private daily — the write is entirely local', async () => {
    files.set(DAILY, '---\nprivate: true\n---\n\n- secret plans\n')
    addTextSpool(textEnvelope())

    await drain()

    expect(files.get(DAILY)).toContain('- call the bank')
    expect(scrapeMock).not.toHaveBeenCalled()
    expect(describeMock).not.toHaveBeenCalled()
  })

  it('quarantines a text envelope that fails validation', async () => {
    addTextSpool(textEnvelope({ text: 'line one\nline two' }))

    const outcome = await drain()

    expect(outcome.invalid).toBe(1)
    expect(rejected.has('a1b2c3d4-0000-4000-8000-000000000001.json')).toBe(true)
    expect(files.has(DAILY)).toBe(false)
  })

  it('never writes a capture note for a text envelope', async () => {
    addTextSpool(textEnvelope())

    await drain()

    expect([...files.keys()]).toEqual([DAILY])
  })
})

describe('drainCaptureInbox (iCloud-evicted notes)', () => {
  const MAC_DAILY = '# Thursday\n\nWritten on the Mac, not yet downloaded here.\n'

  it('never writes over a daily that is still an iCloud stub: stops, keeps the spool, requests the download', async () => {
    evicted.set(DAILY, MAC_DAILY)
    addSpool(envelope())

    const outcome = await drain()

    expect(outcome.stopped).toEqual({
      reason: 'evicted',
      message: `${DAILY} is still downloading from iCloud`,
    })
    expect(outcome.drained).toBe(0)
    expect(writeNoteMock).not.toHaveBeenCalledWith(DAILY, expect.anything(), expect.anything())
    expect(files.has(DAILY)).toBe(false)
    expect(requestDownloadsMock).toHaveBeenCalledWith([DAILY])
    expect(spool.size).toBe(2) // envelope + screenshot, both retryable
  })

  it('the next pass after the download appends under the real daily text', async () => {
    evicted.set(DAILY, MAC_DAILY)
    addSpool(envelope())
    await drain()

    evicted.delete(DAILY)
    files.set(DAILY, MAC_DAILY)
    const outcome = await drain()

    expect(outcome.stopped).toBeNull()
    expect(outcome.drained).toBe(1)
    const daily = files.get(DAILY) ?? ''
    expect(daily.startsWith(MAC_DAILY)).toBe(true)
    expect(daily).toContain(`[[${IDENTITY.base}|An article]]`)
    expect(spool.size).toBe(0)
  })

  it('uses the note when the download lands between the two reads', async () => {
    evicted.set(DAILY, MAC_DAILY)
    // readNote still sees the stub, readNoteLocal already sees the bytes.
    readNoteMock.mockImplementationOnce(async () => {
      evicted.delete(DAILY)
      files.set(DAILY, MAC_DAILY)
      throw { kind: 'notFound', message: 'missing' }
    })
    addSpool(envelope(), { screenshot: false })

    const outcome = await drain()

    expect(outcome.stopped).toBeNull()
    expect(files.get(DAILY)?.startsWith(MAC_DAILY)).toBe(true)
  })

  it('a text capture never writes over an evicted daily either', async () => {
    evicted.set(DAILY, MAC_DAILY)
    spool.set('a1b2c3d4-0000-4000-8000-000000000009.json', {
      contents: JSON.stringify({
        version: 1,
        id: 'a1b2c3d4-0000-4000-8000-000000000009',
        kind: 'append',
        text: 'call the bank',
        capturedAt: CAPTURED_AT.toISOString(),
        source: 'deep-link',
      }),
      modifiedMs: 0,
    })

    const first = await drain()
    expect(first.stopped?.reason).toBe('evicted')
    expect(files.has(DAILY)).toBe(false)
    expect(spool.size).toBe(1)

    downloadOnRequest.enabled = true
    await drain() // requests again; this time the fake download completes
    const outcome = await drain()

    expect(outcome.stopped).toBeNull()
    expect(files.get(DAILY)).toBe(`${MAC_DAILY}\n- call the bank\n`)
    expect(spool.size).toBe(0)
  })

  it('an evicted same-day capture note stops the pass instead of capturing the link twice', async () => {
    addSpool(
      envelope({
        id: '00000000-0000-4000-8000-000000000001',
        capturedAt: new Date(2026, 5, 11, 9, 30, 0, 0).toISOString(),
      }),
      { screenshot: false },
    )
    await drain()
    const originalNotePath = 'notes/capture-2026-06-11-093000-000-0000.md'
    evicted.set(originalNotePath, files.get(originalNotePath) ?? '')
    files.delete(originalNotePath)
    const dailyBefore = files.get(DAILY)

    addSpool(envelope(), { screenshot: false }) // same URL, same day, 15:30
    const outcome = await drain()

    expect(outcome.stopped?.reason).toBe('evicted')
    expect(files.has(IDENTITY.notePath)).toBe(false)
    expect(files.get(DAILY)).toBe(dailyBefore)
    expect(requestDownloadsMock).toHaveBeenCalledWith([originalNotePath])
  })

  it('a missing daily (no stub) is still created as before', async () => {
    addSpool(envelope(), { screenshot: false })

    const outcome = await drain()

    expect(outcome.stopped).toBeNull()
    expect(requestDownloadsMock).not.toHaveBeenCalled()
    expect(files.get(DAILY)).toContain(`[[${IDENTITY.base}|An article]]`)
  })
})

describe('drainCaptureInbox: placed captures (iOS share sheet)', () => {
  const shared = (overrides: Partial<Parameters<typeof envelope>[0]> = {}) =>
    envelope({ source: 'ios-share', look: 'card', ...overrides })

  it('writes the link in its look at the end of the daily Links section', async () => {
    files.set(DAILY, '# plans\n\n## Links\n\n- [[old|Old]]\n\n## Later\n\ntext\n')
    addSpool(shared({ look: 'large', note: 'Read on the train' }), { screenshot: false })

    const outcome = await drain()

    expect(outcome).toMatchObject({ drained: 1, stopped: null })
    expect(files.get(DAILY)).toBe(
      '# plans\n\n## [[Links]]\n\n- [[old|Old]]\n\n```embed\nhttps://example.com/article\nlayout: large\n```\n\nRead on the train\n\n## Later\n\ntext\n',
    )
    expect([...files.keys()].some((path) => path.startsWith('notes/capture-'))).toBe(false)
    expect(spool.size).toBe(0)
  })

  it('appends to the chosen note, and falls back to the daily when it is gone', async () => {
    files.set('Projects/Kore.md', '# Kore\n\nIdeas\n')
    addSpool(shared({ look: 'link', destination: { kind: 'note', path: 'Projects/Kore.md' } }), {
      screenshot: false,
    })
    addSpool(
      shared({
        id: '00000000-0000-4000-8000-000000000002',
        destination: { kind: 'note', path: 'Projects/Deleted.md' },
      }),
      { screenshot: false, modifiedMs: 1 },
    )

    await drain()

    expect(files.get('Projects/Kore.md')).toBe(
      '# Kore\n\nIdeas\n\n[An article](https://example.com/article)\n',
    )
    expect(files.get(DAILY)).toBe('## [[Links]]\n\nhttps://example.com/article\n')
  })

  it('creates a new note in the chosen folder and links it from the daily', async () => {
    addSpool(
      shared({ destination: { kind: 'new', title: 'Bitter lesson', folder: 'Input/Clippings' } }),
      { screenshot: false },
    )

    await drain()

    const created = files.get('Input/Clippings/bitter-lesson.md') ?? ''
    expect(created).toContain('# Bitter lesson\n\nhttps://example.com/article\n')
    expect(files.get(DAILY)).toBe('## [[Links]]\n\n[[bitter-lesson|Bitter lesson]]\n')
  })

  it('quotes the selected text, and skips a link the destination already holds', async () => {
    addSpool(shared({ look: 'text', selection: 'First line\n\nSecond line' }), {
      screenshot: false,
    })
    await drain()
    expect(files.get(DAILY)).toBe(
      '## [[Links]]\n\nhttps://example.com/article\n\n> First line\n>\n> Second line\n',
    )

    addSpool(shared({ id: '00000000-0000-4000-8000-000000000003' }), { screenshot: false })
    const again = await drain()
    expect(again).toMatchObject({ drained: 1, deduped: 1 })
    expect(files.get(DAILY)?.match(/example\.com\/article/g)).toHaveLength(1)
  })
})

describe('drainCaptureInbox: shared X posts', () => {
  const POST_URL = 'https://x.com/karpathy/status/1886192184808149383'
  const post = (overrides: Partial<Parameters<typeof envelope>[0]> = {}) =>
    envelope({ source: 'ios-share', url: POST_URL, title: '', look: 'text', ...overrides })

  it('writes a post as a list-item card under Links, linked to the X posts note', async () => {
    files.set(DAILY, '# plans\n\nMorning notes\n\n## [[Links]]\n\n- [[old|Old]]\n')
    xPostMock.mockResolvedValue({
      id: '1886192184808149383',
      createdAt: '2026-02-02T23:30:00Z',
      author: {
        name: 'Andrej Karpathy',
        handle: 'karpathy',
        avatar: 'https://pbs.twimg.com/profile_images/1/face_normal.jpg',
      },
      body: [
        { type: 'text', text: 'Vibe coding, see ' },
        { type: 'link', text: 'this', url: 'https://example.com/vibe' },
        { type: 'text', text: '.\nSecond line' },
      ],
      media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/a.jpg', width: 1, height: 1 }],
    })
    addSpool(post({ note: 'Worth a read' }), { screenshot: false })

    await drain()

    const daily = files.get(DAILY) ?? ''
    expect(daily).toBe(
      [
        '# plans',
        '',
        'Morning notes',
        '',
        '## [[Links]]',
        '',
        '- [[old|Old]]',
        '',
        `- ![|40](assets/x-avatar-karpathy.jpg) **Andrej Karpathy** [@karpathy](https://x.com/karpathy) [2 Feb 2026](${POST_URL}) [[X posts]]`,
        '',
        '  > Vibe coding, see [this](https://example.com/vibe).',
        '  > Second line',
        '  >',
        '  > ![](assets/x-1886192184808149383-1.jpg)',
        '',
        '  Worth a read',
        '',
      ].join('\n'),
    )
    expect(ensureBacklinkTargetMock).toHaveBeenCalledWith('X posts', expect.any(Number))
    expect(importImageMock).toHaveBeenCalledWith(
      'https://pbs.twimg.com/media/a.jpg',
      'x-1886192184808149383-1.jpg',
      expect.any(Number),
    )
    expect(importImageMock).toHaveBeenCalledWith(
      'https://pbs.twimg.com/profile_images/1/face_200x200.jpg',
      'x-avatar-karpathy.jpg',
      expect.any(Number),
    )
    // The X posts note's backlink shows the post whole: byline, words, photo, note.
    expect(blockContextAt(daily, daily.indexOf('[[X posts]]') + 2)).toBe(
      daily.slice(daily.indexOf('- ![|40]')).trimEnd(),
    )
  })

  it("keeps X's own link to a photo that cannot be fetched now", async () => {
    xPostMock.mockResolvedValue({
      id: '1886192184808149383',
      createdAt: '2026-02-02T12:00:00Z',
      author: { name: 'Andrej Karpathy', handle: 'karpathy' },
      body: [{ type: 'text', text: 'Look' }],
      media: [
        {
          type: 'photo',
          url: 'https://pbs.twimg.com/media/b?format=png&name=large',
          width: 1,
          height: 1,
        },
      ],
    })
    importImageMock.mockRejectedValueOnce({ kind: 'network', message: 'offline' })
    addSpool(post(), { screenshot: false })

    await drain()

    expect(importImageMock).toHaveBeenCalledWith(
      'https://pbs.twimg.com/media/b?format=png&name=large',
      'x-1886192184808149383-1.png',
      expect.any(Number),
    )
    expect(files.get(DAILY)).toContain(
      '  > ![](https://pbs.twimg.com/media/b?format=png&name=large)',
    )
    expect(files.get(DAILY)).toContain(
      `- **Andrej Karpathy** [@karpathy](https://x.com/karpathy) [2 Feb 2026](${POST_URL}) [[X posts]]`,
    )
  })

  it('keeps the author line and the link when the post cannot be read', async () => {
    xPostMock.mockRejectedValue(new Error('offline'))
    addSpool(post(), { screenshot: false })

    await drain()

    expect(files.get(DAILY)).toBe(`## [[Links]]\n\n- [@karpathy](${POST_URL}) [[X posts]]\n`)
  })

  it('files a post embed under Links too', async () => {
    addSpool(post({ look: 'embed' }), { screenshot: false })

    await drain()

    expect(files.get(DAILY)).toBe(`## [[Links]]\n\n![](${POST_URL})\n`)
  })
})

describe('drainCaptureInbox: shared files (iOS share sheet)', () => {
  const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
  function addFileSpool(
    names: string[],
    overrides: Partial<FileCaptureEnvelope> = {},
  ): FileCaptureEnvelope {
    const capture: FileCaptureEnvelope = {
      version: 1,
      id: ID,
      kind: 'file',
      files: names.map((name, index) => ({
        ref: `${ID}.${index + 1}.${name.slice(name.lastIndexOf('.') + 1).toLowerCase()}`,
        name,
      })),
      capturedAt: CAPTURED_AT.toISOString(),
      source: 'ios-share',
      ...overrides,
    }
    spool.set(`${ID}.json`, { contents: JSON.stringify(capture), modifiedMs: 0 })
    for (const file of capture.files) {
      spool.set(file.ref, { contents: `bytes of ${file.name}`, modifiedMs: 0 })
    }
    return capture
  }

  it('moves photos and a PDF into the vault and embeds them in the daily body', async () => {
    files.set(DAILY, '# plans\n\n## [[Links]]\n\n- [[old|Old]]\n')
    files.set('assets/img-0042.jpg', 'an older photo')
    addFileSpool(['IMG_0042.JPG', 'Q3 Report (final).pdf'], { note: 'From the offsite' })

    const outcome = await drain()

    expect(outcome).toMatchObject({ drained: 1, stopped: null })
    expect(files.get('assets/img-0042-2.jpg')).toBe('bytes of IMG_0042.JPG')
    expect(files.get('assets/q3-report-final.pdf')).toBe('bytes of Q3 Report (final).pdf')
    expect(files.get(DAILY)).toBe(
      [
        '# plans',
        '',
        '![](assets/img-0042-2.jpg)',
        '',
        '[Q3 Report (final).pdf](assets/q3-report-final.pdf)',
        '',
        'From the offsite',
        '',
        '## [[Links]]',
        '',
        '- [[old|Old]]',
        '',
      ].join('\n'),
    )
    expect(spool.size).toBe(0)
  })

  it('writes into the chosen note, or a new note linked from the daily', async () => {
    files.set('Projects/Kore.md', '# Kore\n')
    addFileSpool(['scan.pdf'], { destination: { kind: 'note', path: 'Projects/Kore.md' } })
    await drain()
    expect(files.get('Projects/Kore.md')).toBe('# Kore\n\n[scan.pdf](assets/scan.pdf)\n')

    addFileSpool(['Board deck.pdf'], {
      destination: { kind: 'new', title: 'Board deck', folder: 'Work' },
    })
    await drain()
    expect(files.get('Work/board-deck.md')).toContain(
      '# Board deck\n\n[Board deck.pdf](assets/board-deck.pdf)\n',
    )
    expect(files.get(DAILY)).toBe('[[board-deck|Board deck]]\n')
  })

  it('escapes a space in the attachment folder so the link stays one destination', async () => {
    importSpoolMock.mockResolvedValueOnce('Files (shared)/photo one.png')
    addFileSpool(['photo one.png'])

    await drain()

    expect(files.get(DAILY)).toBe('![](Files%20%28shared%29/photo%20one.png)\n')
  })

  it('still lands the rest of a share when one file never arrived', async () => {
    const capture = addFileSpool(['a.png', 'b.pdf'])
    spool.delete(capture.files[0]?.ref ?? '')

    const outcome = await drain()

    expect(outcome).toMatchObject({ drained: 1, stopped: null })
    expect(files.get(DAILY)).toBe('[b.pdf](assets/b.pdf)\n')
  })

  it('keeps the spool for a retry when the copy fails', async () => {
    importSpoolMock.mockRejectedValueOnce({ kind: 'io', message: 'disk full' })
    addFileSpool(['a.png'])

    const outcome = await drain()

    expect(outcome.stopped).toMatchObject({ reason: 'io' })
    expect(spool.size).toBe(2)
    expect(files.has(DAILY)).toBe(false)
  })

  it('quarantines an unreadable file envelope together with its files', async () => {
    const capture = addFileSpool(['a.png'])
    spool.set(`${ID}.json`, { contents: '{"kind":"file"}', modifiedMs: 0 })

    await drain()

    expect(rejected.has(`${ID}.json`)).toBe(true)
    expect(rejected.has(capture.files[0]?.ref ?? '')).toBe(true)
    expect(spool.size).toBe(0)
  })

  it('sweeps an old file no envelope claims, never a young one', async () => {
    spool.set(`${ID}.1.png`, { contents: 'old', modifiedMs: 0 })
    spool.set('00000000-0000-4000-8000-000000000009.1.pdf', {
      contents: 'young',
      modifiedMs: 2 * 60 * 60 * 1000,
    })

    await drain({ now: () => 2 * 60 * 60 * 1000 + 1 })

    expect(spool.has(`${ID}.1.png`)).toBe(false)
    expect(spool.has('00000000-0000-4000-8000-000000000009.1.pdf')).toBe(true)
  })
})
