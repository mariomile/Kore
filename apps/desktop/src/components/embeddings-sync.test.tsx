import { render } from 'vitest-browser-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbedStatus, IndexAppliedListener } from '@reflect/core'
import { EmbeddingsSync } from './embeddings-sync'

const core = vi.hoisted(() => ({
  embedNote: vi.fn(async () => ({ written: 0 })),
  embedRemove: vi.fn(async () => {}),
  subscribeIndexApplied: vi.fn(),
}))
const graphState = vi.hoisted(() => ({ indexReady: true }))
const modelState = vi.hoisted((): { current: EmbedStatus } => ({
  current: { status: 'ready', model: 'all-MiniLM-L6-v2' },
}))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  embedNote: core.embedNote,
  embedRemove: core.embedRemove,
  subscribeIndexApplied: core.subscribeIndexApplied,
}))

const semantic = vi.hoisted(() => ({
  backfillEmbeddingsVisibly: vi.fn(async () => 'completed' as const),
  consumeLegacySemanticOptIn: vi.fn(() => false),
  ensureEmbeddingsVisibly: vi.fn(async () => ({ status: 'ready', model: 'all-MiniLM-L6-v2' })),
}))
vi.mock('@/lib/semantic', () => semantic)

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({
    graph: { root: '/g', name: 'g', generation: 1 },
    indexGeneration: 7,
    indexReady: graphState.indexReady,
  }),
}))
const semanticSetting = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { semanticSearchEnabled: semanticSetting.enabled },
    updateSettings: () => {},
  }),
}))
vi.mock('@/lib/use-embed-status', () => ({
  useEmbedStatus: () => modelState.current,
}))

let onApplied: IndexAppliedListener | null = null
const unlisten = vi.fn()

beforeEach(() => {
  semanticSetting.enabled = true
  graphState.indexReady = true
  modelState.current = { status: 'ready', model: 'all-MiniLM-L6-v2' }
  onApplied = null
  unlisten.mockClear()
  core.embedNote.mockReset().mockResolvedValue({ written: 0 })
  core.embedRemove.mockClear()
  semantic.backfillEmbeddingsVisibly.mockReset()
  semantic.backfillEmbeddingsVisibly.mockImplementation(async () => 'completed')
  core.subscribeIndexApplied.mockReset().mockImplementation((handler: IndexAppliedListener) => {
    onApplied = handler
    return unlisten
  })
})

/** One macrotask — long enough for a would-be queue item to have started. */
function flushQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('EmbeddingsSync', () => {
  it('backfills and follows applied index batches while enabled and ready', async () => {
    await render(<EmbeddingsSync />)
    await vi.waitFor(() => expect(semantic.backfillEmbeddingsVisibly).toHaveBeenCalled())
    await vi.waitFor(() => expect(onApplied).not.toBeNull())

    onApplied?.([{ kind: 'upsert', path: 'notes/a.md' }], 7)
    await vi.waitFor(() =>
      expect(core.embedNote).toHaveBeenCalledWith({
        path: 'notes/a.md',
        generation: 7,
        modelId: 'all-MiniLM-L6-v2',
        isStale: expect.any(Function),
      }),
    )
  })

  it('ignores a delayed emit from a superseded index session', async () => {
    await render(<EmbeddingsSync />)
    await vi.waitFor(() => expect(onApplied).not.toBeNull())

    onApplied?.([{ kind: 'upsert', path: 'notes/a.md' }], 6)
    await flushQueue()
    expect(core.embedNote).not.toHaveBeenCalled()
  })

  it('never embeds asset-file changes riding the same batches', async () => {
    await render(<EmbeddingsSync />)
    await vi.waitFor(() => expect(onApplied).not.toBeNull())

    onApplied?.(
      [
        { kind: 'upsert', path: 'assets/photo.png' },
        { kind: 'remove', path: 'assets/old.pdf' },
      ],
      7,
    )
    await flushQueue()
    expect(core.embedNote).not.toHaveBeenCalled()
    expect(core.embedRemove).not.toHaveBeenCalled()
  })

  it('starts no embedding work while semantic search is disabled', async () => {
    semanticSetting.enabled = false
    await render(<EmbeddingsSync />)
    await flushQueue()
    expect(semantic.backfillEmbeddingsVisibly).not.toHaveBeenCalled()
    expect(core.subscribeIndexApplied).not.toHaveBeenCalled()
  })

  it('starts no embedding work until the index session has finished reconciling', async () => {
    graphState.indexReady = false
    await render(<EmbeddingsSync />)
    await flushQueue()
    expect(semantic.backfillEmbeddingsVisibly).not.toHaveBeenCalled()
    expect(core.subscribeIndexApplied).not.toHaveBeenCalled()
  })

  it('coalesces follow-up work that arrives during backfill into unique paths', async () => {
    let releaseBackfill = (): void => {}
    semantic.backfillEmbeddingsVisibly.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseBackfill = () => resolve('completed')
        }),
    )
    await render(<EmbeddingsSync />)
    await vi.waitFor(() => expect(onApplied).not.toBeNull())

    for (let index = 0; index < 8; index += 1) {
      onApplied?.([{ kind: 'upsert', path: 'notes/a.md' }], 7)
    }
    onApplied?.([{ kind: 'upsert', path: 'notes/b.md' }], 7)
    expect(core.embedNote).not.toHaveBeenCalled()

    releaseBackfill()
    await vi.waitFor(() => expect(core.embedNote).toHaveBeenCalledTimes(2))
    expect(core.embedNote).toHaveBeenCalledWith({
      path: 'notes/a.md',
      generation: 7,
      modelId: 'all-MiniLM-L6-v2',
      isStale: expect.any(Function),
    })
    expect(core.embedNote).toHaveBeenCalledWith({
      path: 'notes/b.md',
      generation: 7,
      modelId: 'all-MiniLM-L6-v2',
      isStale: expect.any(Function),
    })
  })

  it('bounds failed-job retries without dropping the rest of the batch or future changes', async () => {
    const error = new Error('embedding failed')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    core.embedNote
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ written: 1 })
      .mockRejectedValueOnce(error)
    try {
      await render(<EmbeddingsSync />)
      await vi.waitFor(() => expect(onApplied).not.toBeNull())
      onApplied?.(
        [
          { kind: 'upsert', path: 'notes/bad.md' },
          { kind: 'upsert', path: 'notes/healthy.md' },
          { kind: 'remove', path: 'notes/deleted.md' },
        ],
        7,
      )
      await vi.waitFor(() => expect(core.embedNote).toHaveBeenCalledTimes(3))
      expect(core.embedRemove).toHaveBeenCalledWith('notes/deleted.md', 7)
      await flushQueue()
      expect(core.embedNote).toHaveBeenCalledTimes(3)
      expect(logged).toHaveBeenCalledTimes(1)
      onApplied?.([{ kind: 'upsert', path: 'notes/bad.md' }], 7)
      await vi.waitFor(() => expect(core.embedNote).toHaveBeenCalledTimes(4))
    } finally {
      logged.mockRestore()
    }
  })

  it('lets a newer deletion replace the retry of an in-flight failed upsert', async () => {
    let fail: (error: Error) => void = () => {}
    core.embedNote.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject
        }),
    )
    await render(<EmbeddingsSync />)
    await vi.waitFor(() => expect(onApplied).not.toBeNull())
    onApplied?.([{ kind: 'upsert', path: 'notes/a.md' }], 7)
    await vi.waitFor(() => expect(core.embedNote).toHaveBeenCalledTimes(1))
    onApplied?.([{ kind: 'remove', path: 'notes/a.md' }], 7)
    fail(new Error('removed while embedding'))
    await vi.waitFor(() => expect(core.embedRemove).toHaveBeenCalledWith('notes/a.md', 7))
    await flushQueue()
    expect(core.embedNote).toHaveBeenCalledTimes(1)
  })

  it('pauses follow-up work the moment semantic search is disabled', async () => {
    const view = await render(<EmbeddingsSync />)
    await vi.waitFor(() => expect(onApplied).not.toBeNull())

    semanticSetting.enabled = false
    await view.rerender(<EmbeddingsSync />)
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalled())

    // A batch still in flight when the teardown ran must be dropped, not
    // embedded behind the user's back.
    onApplied?.([{ kind: 'upsert', path: 'notes/b.md' }], 7)
    await flushQueue()
    expect(core.embedNote).not.toHaveBeenCalled()
  })

  it('follows edits across idle unload and reload without another graph backfill', async () => {
    const view = await render(<EmbeddingsSync />)
    await vi.waitFor(() => expect(onApplied).not.toBeNull())
    modelState.current = { status: 'unloaded', model: 'all-MiniLM-L6-v2' }
    await view.rerender(<EmbeddingsSync />)
    onApplied?.([{ kind: 'upsert', path: 'notes/idle-edit.md' }], 7)
    await vi.waitFor(() => expect(core.embedNote).toHaveBeenCalledTimes(1))
    modelState.current = { status: 'loading' }
    await view.rerender(<EmbeddingsSync />)
    modelState.current = { status: 'ready', model: 'all-MiniLM-L6-v2' }
    await view.rerender(<EmbeddingsSync />)
    await flushQueue()
    expect(semantic.backfillEmbeddingsVisibly).toHaveBeenCalledTimes(1)
    expect(core.subscribeIndexApplied).toHaveBeenCalledTimes(1)
    expect(unlisten).not.toHaveBeenCalled()
  })

  it('initializes synchronization when the graph opens with an unloaded model', async () => {
    modelState.current = { status: 'unloaded', model: 'all-MiniLM-L6-v2' }
    await render(<EmbeddingsSync />)
    await vi.waitFor(() => expect(semantic.backfillEmbeddingsVisibly).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(onApplied).not.toBeNull())
  })
})
