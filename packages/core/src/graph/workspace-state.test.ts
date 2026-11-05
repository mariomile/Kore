import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import type { OpenColumn } from '../settings/schema'
import { createWorkspaceStatePublisher, workspaceNotes } from './workspace-state'

const columns: OpenColumn[] = [
  {
    id: 'main',
    panes: [
      {
        id: 'main',
        activeKey: 'note:notes/Foo.md',
        tabs: [
          { kind: 'note', path: 'notes/Foo.md', pinned: false },
          { kind: 'surface', surface: 'daily', date: null, pinned: true },
          { kind: 'chat', conversationId: 'c1', pinned: false },
        ],
      },
      {
        id: 'right',
        activeKey: 'chat:c1',
        tabs: [{ kind: 'note', path: 'notes/Foo.md', pinned: false }],
      },
    ],
  },
]

describe('workspace state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    setBridge(null)
  })

  it('lists note tabs in strip order, deduped, and the focused pane active note', () => {
    expect(workspaceNotes(columns, 'main', '2026-11-05')).toEqual({
      activeNote: 'notes/Foo.md',
      openNotes: ['daily/2026-11-05.md', 'notes/Foo.md'],
    })
    expect(workspaceNotes(columns, 'right', '2026-11-05').activeNote).toBeNull()
  })

  it('debounces writes and skips unchanged snapshots', async () => {
    const invoke = vi.fn(async () => null)
    setBridge({ invoke, listen: async () => () => {} })
    const publisher = createWorkspaceStatePublisher(3)
    publisher.publish({ activeNote: null, openNotes: [] })
    publisher.publish({ activeNote: 'notes/A.md', openNotes: ['notes/A.md'] })
    publisher.publish({ activeNote: 'notes/A.md', openNotes: ['notes/A.md'] })
    await vi.advanceTimersByTimeAsync(600)
    expect(invoke).toHaveBeenCalledTimes(1)
    const [command, args] = invoke.mock.calls[0] as unknown as [
      string,
      { contents: string; generation: number },
    ]
    expect(command).toBe('workspace_state_write')
    expect(args.generation).toBe(3)
    expect(JSON.parse(args.contents)).toMatchObject({
      version: 1,
      activeNote: 'notes/A.md',
      openNotes: ['notes/A.md'],
    })
  })
})
