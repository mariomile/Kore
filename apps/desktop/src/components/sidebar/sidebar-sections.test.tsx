import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@reflect/core'
import { INVALIDATE_THROTTLE_MS } from '@/lib/query-client'
import { SidebarSections } from './sidebar-sections'

const graphState = vi.hoisted(() => ({ indexing: true }))
vi.mock('@/providers/graph-provider', () => ({ useGraph: () => graphState }))
vi.mock('@/hooks/use-folder-tree', () => ({ useFolderTree: () => null }))
vi.mock('@/hooks/use-tag-tree', () => ({ useTagTree: () => [] }))
vi.mock('@/hooks/use-pinned-notes', () => ({
  usePinnedNotes: () => [],
  pinnedNotesQueryKey: (root: string | undefined) => ['index', root, 'pinned-notes'],
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { ...DEFAULT_SETTINGS, sidebarSections: [] },
    updateSettingsWith: () => {},
  }),
}))

afterEach(() => {
  vi.useRealTimers()
  graphState.indexing = true
})

describe('SidebarSections placeholder', () => {
  it('outlasts the index pass by one refetch window while no shelf has data', async () => {
    const view = await render(<SidebarSections />)
    const placeholder = page.getByTestId('sidebar-shelves-placeholder')
    await expect.element(placeholder).toBeInTheDocument()

    vi.useFakeTimers()
    graphState.indexing = false
    await view.rerender(<SidebarSections />)
    // The pass ended but the shelves' trailing refetch has not landed yet.
    await expect.element(placeholder).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(INVALIDATE_THROTTLE_MS)
    vi.useRealTimers()
    await expect.element(placeholder).not.toBeInTheDocument()
  })

  it('shows no placeholder when nothing is indexing', async () => {
    graphState.indexing = false
    await render(<SidebarSections />)
    await expect.element(page.getByTestId('sidebar-shelves-placeholder')).not.toBeInTheDocument()
  })
})
