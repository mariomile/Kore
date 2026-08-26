import { useSyncExternalStore } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { icloudAdoptGraph, type GraphInfo } from '@reflect/core'
import type { BackupState } from '@/lib/backup-controller'
import '@/test-utils/locator'
import { EnableLocalSyncDialog } from './enable-local-sync-dialog'

const core = vi.hoisted(() => ({
  status: {
    available: true,
    documentsRoot: '/Users/alex/Library/Mobile Documents/iCloud~app/Documents' as string | null,
    existingGraphRoots: [] as string[],
  },
  adoptedRoot: '/Users/alex/Library/Mobile Documents/iCloud~app/Documents/Notes',
}))

const graph = vi.hoisted(() => ({
  current: {
    root: '/Users/alex/Documents/Notes',
    name: 'Notes',
    generation: 1,
  } as GraphInfo | null,
  pendingLocalSyncOffer: true,
  dismissLocalSyncOffer: vi.fn(),
  openRecent: vi.fn<(root: string) => Promise<boolean>>(async () => true),
}))

const sync = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  let version = 0
  const state = {
    backup: { phase: 'disconnected' } as BackupState,
    disconnectGraph: vi.fn(async () => {}),
    connectNewRepo: vi.fn(),
    connectExistingRepo: vi.fn(),
    setBackup(next: BackupState) {
      state.backup = next
      version += 1
      for (const listener of listeners) {
        listener()
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getVersion(): number {
      return version
    },
  }
  return state
})

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  icloudStatus: vi.fn(async () => core.status),
  icloudAdoptGraph: vi.fn(async () => core.adoptedRoot),
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({
    graph: graph.current,
    pendingLocalSyncOffer: graph.pendingLocalSyncOffer,
    dismissLocalSyncOffer: graph.dismissLocalSyncOffer,
    openRecent: graph.openRecent,
  }),
}))
vi.mock('@/providers/sync-provider', () => ({
  useSync: () => {
    useSyncExternalStore(sync.subscribe, sync.getVersion)
    return sync
  },
}))

async function renderDialog(): Promise<void> {
  await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EnableLocalSyncDialog />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  graph.current = {
    root: '/Users/alex/Documents/Notes',
    name: 'Notes',
    generation: 1,
  }
  graph.pendingLocalSyncOffer = true
  graph.dismissLocalSyncOffer.mockReset()
  graph.openRecent.mockReset().mockResolvedValue(true)
  core.status = {
    available: true,
    documentsRoot: '/Users/alex/Library/Mobile Documents/iCloud~app/Documents',
    existingGraphRoots: [],
  }
  sync.setBackup({ phase: 'disconnected' })
  sync.disconnectGraph.mockReset().mockResolvedValue()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('EnableLocalSyncDialog', () => {
  it('offers iCloud and GitHub when iCloud Drive is available', async () => {
    await renderDialog()

    await expect
      .element(page.getByRole('heading', { name: 'Sync this folder across devices?' }))
      .toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Enable iCloud sync' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Connect GitHub…' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Keep this folder as-is' })).toBeVisible()
  })

  it('hides iCloud and leads with GitHub when iCloud Drive is unavailable', async () => {
    core.status = {
      available: false,
      documentsRoot: null,
      existingGraphRoots: [],
    }
    await renderDialog()

    await expect.element(page.getByRole('button', { name: 'Connect GitHub…' })).toBeVisible()
    await expect.element(page.getByText('Checking iCloud…')).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Enable iCloud sync' }))
      .not.toBeInTheDocument()
  })

  it('dismisses when the folder is kept as-is', async () => {
    await renderDialog()
    await userEvent.click(page.getByRole('button', { name: 'Keep this folder as-is' }))
    expect(graph.dismissLocalSyncOffer).toHaveBeenCalledOnce()
  })

  it('copies the folder into iCloud Drive and dismisses on success', async () => {
    await renderDialog()
    await userEvent.click(page.getByRole('button', { name: 'Enable iCloud sync' }))

    await vi.waitFor(() => expect(icloudAdoptGraph).toHaveBeenCalledWith(1))
    await vi.waitFor(() => expect(graph.openRecent).toHaveBeenCalledWith(core.adoptedRoot))
    expect(graph.dismissLocalSyncOffer).toHaveBeenCalled()
  })

  it('opens the GitHub wizard without leaving the original folder', async () => {
    await renderDialog()
    await userEvent.click(page.getByRole('button', { name: 'Connect GitHub…' }))

    await expect.element(page.getByRole('heading', { name: 'Connect GitHub' })).toBeVisible()
    expect(graph.dismissLocalSyncOffer).not.toHaveBeenCalled()
  })

  it('keeps the GitHub wizard mounted while backup is connecting', async () => {
    await renderDialog()
    await userEvent.click(page.getByRole('button', { name: 'Connect GitHub…' }))
    await expect.element(page.getByRole('heading', { name: 'Connect GitHub' })).toBeVisible()

    sync.setBackup({ phase: 'loading' })

    await expect.element(page.getByRole('heading', { name: 'Connect GitHub' })).toBeVisible()
    expect(graph.dismissLocalSyncOffer).not.toHaveBeenCalled()
  })

  it('does not render when the offer is not pending', async () => {
    graph.pendingLocalSyncOffer = false
    await renderDialog()
    await expect
      .element(page.getByRole('heading', { name: 'Sync this folder across devices?' }))
      .not.toBeInTheDocument()
  })

  it('does not render for a graph already in iCloud Drive', async () => {
    graph.current = {
      root: '/Users/alex/Library/Mobile Documents/iCloud~app/Documents/Notes',
      name: 'Notes',
      generation: 1,
    }
    await renderDialog()
    await expect
      .element(page.getByRole('heading', { name: 'Sync this folder across devices?' }))
      .not.toBeInTheDocument()
  })

  it('dismisses itself when GitHub sync is already connected', async () => {
    sync.setBackup({
      phase: 'connected',
      remoteUrl: 'https://github.com/alex/notes.git',
      repo: { owner: 'alex', name: 'notes' },
      status: { state: 'idle' },
    })
    await renderDialog()
    await vi.waitFor(() => expect(graph.dismissLocalSyncOffer).toHaveBeenCalled())
    await expect
      .element(page.getByRole('heading', { name: 'Sync this folder across devices?' }))
      .not.toBeInTheDocument()
  })
})
