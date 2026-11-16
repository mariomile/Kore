import { describe, expect, it } from 'vitest'
import { workspaceLayoutSchema } from './layout'

describe('workspaceLayoutSchema', () => {
  it('accepts note, chat, and route tabs while dropping a malformed graph list', () => {
    const parsed = workspaceLayoutSchema.parse({
      '/g': [
        {
          id: 'main',
          panes: [
            {
              id: 'main',
              activeKey: null,
              tabs: [
                { kind: 'surface', surface: 'daily', date: null, pinned: false },
                { kind: 'note', path: 'notes/alpha.md', pinned: true },
                { kind: 'chat', conversationId: 'conversation-1', pinned: false },
                {
                  kind: 'surface',
                  surface: 'allNotes',
                  filter: { kind: 'tag', tag: 'book' },
                  pinned: false,
                },
                { kind: 'surface', surface: 'search', query: 'alpha', pinned: false },
                { kind: 'surface', surface: 'tasks', pinned: false },
                { kind: 'localGraph', path: 'notes/alpha.md', pinned: false },
              ],
            },
          ],
        },
      ],
      '/broken': [
        {
          id: 'main',
          panes: [{ id: 'main', activeKey: null, tabs: [{ kind: 'chat', pinned: false }] }],
        },
      ],
    })
    expect(parsed).toEqual({
      '/g': [
        {
          id: 'main',
          panes: [
            {
              id: 'main',
              activeKey: null,
              tabs: [
                { kind: 'surface', surface: 'daily', date: null, pinned: false },
                { kind: 'note', path: 'notes/alpha.md', pinned: true },
                { kind: 'chat', conversationId: 'conversation-1', pinned: false },
                {
                  kind: 'surface',
                  surface: 'allNotes',
                  filter: { kind: 'tag', tag: 'book' },
                  pinned: false,
                },
                { kind: 'surface', surface: 'search', query: 'alpha', pinned: false },
                { kind: 'surface', surface: 'tasks', pinned: false },
                { kind: 'localGraph', path: 'notes/alpha.md', pinned: false },
              ],
            },
          ],
        },
      ],
      '/broken': [{ id: 'main', panes: [{ id: 'main', activeKey: null, tabs: [] }] }],
    })
  })

  it('drops a column without panes and degrades a malformed document to no layouts', () => {
    expect(
      workspaceLayoutSchema.parse({
        '/graph': [{ id: 'main', tabs: [{ kind: 'note', path: 'notes/a.md', pinned: false }] }],
      }),
    ).toEqual({ '/graph': [] })
    expect(workspaceLayoutSchema.parse('nope')).toEqual({})
  })
})
