import { describe, expect, it, vi } from 'vitest'
import type { OpenColumn, WorkspaceLayout } from '@kore/core'
import { createWorkspaceLayoutStore } from './workspace-layout-store'

function column(id: string): OpenColumn {
  return { id, panes: [{ id: 'main', tabs: [], activeKey: null }] }
}

function storeWith(load: () => Promise<WorkspaceLayout>) {
  const save = vi.fn((_layout: WorkspaceLayout) => Promise.resolve())
  const store = createWorkspaceLayoutStore({
    load,
    save,
    onLoadError: () => {},
    onSaveError: () => {},
  })
  return { store, save }
}

describe('createWorkspaceLayoutStore', () => {
  it('replays launch writes over the stored layout and saves each tick once', async () => {
    const { store, save } = storeWith(() => Promise.resolve({ '/g': [column('stored')] }))
    store.update('/g', (columns) => [...columns, column('launch')])
    expect(store.columnsOf('/g')).toEqual([])

    await store.hydrate()
    expect(store.columnsOf('/g').map((entry) => entry.id)).toEqual(['stored', 'launch'])

    store.update('/g', (columns) => columns.slice(0, 1))
    store.update('/other', () => [column('x')])
    store.update('/other', (columns) => columns)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ '/g': [column('stored')], '/other': [column('x')] })
  })

  it('never saves after a failed load, so an unread document is not wiped', async () => {
    const { store, save } = storeWith(() => Promise.reject(new Error('corrupt')))
    await store.hydrate()
    store.update('/g', () => [column('session')])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.columnsOf('/g').map((entry) => entry.id)).toEqual(['session'])
    expect(save).not.toHaveBeenCalled()
  })
})
