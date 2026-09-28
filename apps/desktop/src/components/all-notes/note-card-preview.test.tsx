import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { invalidateIndexQueries, queryClient } from '@/lib/query-client'
import { NoteCardPreview } from './note-card-preview'

const readNote = vi.hoisted(() => vi.fn())
const graph = vi.hoisted(() => ({ root: '/g', name: 'g', generation: 7 }))

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  readNote,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph }),
}))
vi.mock('@/editor/open-external-link', () => ({
  useOpenExternalLink: () => undefined,
}))

function preview(mtime: number) {
  return (
    <QueryClientProvider client={queryClient}>
      <NoteCardPreview
        path="notes/preview.md"
        mtime={mtime}
        snippet="Loading preview"
        resolveImageUrl={() => null}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  queryClient.clear()
  readNote.mockReset()
  graph.generation = 7
})

afterEach(async () => {
  await cleanup()
  queryClient.clear()
})

describe('NoteCardPreview', () => {
  it('bounds a long paragraph even when its next block is far beyond the preview', async () => {
    readNote.mockResolvedValue(`# Preview\n\n${'x'.repeat(100_000)}\n\nNext block`)
    const view = await render(preview(1))

    await vi.waitFor(() => {
      const content = view.container.querySelector('.meowdown-content')
      expect(content).not.toBeNull()
      expect(content?.textContent?.length).toBeLessThanOrEqual(1400)
    })
  })

  it('reuses an unchanged preview across index updates and reloads after its mtime changes', async () => {
    let source = '# Preview\n\nOriginal body'
    readNote.mockImplementation(async () => source)
    const view = await render(preview(1))
    await expect.element(view.getByText('Original body')).toBeInTheDocument()
    expect(readNote).toHaveBeenCalledWith('notes/preview.md', 7)

    invalidateIndexQueries()
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(readNote).toHaveBeenCalledTimes(1)

    source = '# Preview\n\nUpdated body'
    await view.rerender(preview(2))
    await expect.element(view.getByText('Updated body')).toBeInTheDocument()
    expect(readNote).toHaveBeenCalledTimes(2)

    source = '# Preview\n\nReopened graph body'
    graph.generation = 8
    await view.rerender(preview(2))
    await expect.element(view.getByText('Reopened graph body')).toBeInTheDocument()
    expect(readNote).toHaveBeenCalledWith('notes/preview.md', 8)
  })
})
