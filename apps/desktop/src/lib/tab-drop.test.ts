import { describe, expect, it } from 'vitest'
import type { OpenTab } from '@reflect/core'
import {
  dropTab,
  resolveTabDrop,
  zoneDropId,
  type TabDragData,
  type TabDrop,
  type TabDropPanes,
  type ZoneDropData,
} from '@/lib/tab-drop'

/**
 * The pure half of dragging a tab between panes: what a drag-end event means.
 * The wiring (which `DndContext`, which droppable) is the components' job;
 * everything decided here is decided from the two payloads alone.
 */

const alpha: OpenTab = { kind: 'note', path: 'notes/alpha.md', pinned: false }
const beta: OpenTab = { kind: 'note', path: 'notes/beta.md', pinned: false }

/** The same shape dnd-kit hands to `onDragEnd`: a ref around the payload. */
function held(data: unknown): { data: { current: unknown } } {
  return { data: { current: data } }
}

function tabData(paneId: string, tab: OpenTab): TabDragData {
  return { kind: 'tab', paneId, tab }
}

describe('zoneDropId', () => {
  it('names a pane zone', () => {
    expect(zoneDropId('main', 'right')).toBe('zone:main:right')
  })
})

describe('resolveTabDrop', () => {
  it('reorders when the tab lands on another tab of the same pane', () => {
    expect(resolveTabDrop(held(tabData('main', alpha)), held(tabData('main', beta)))).toEqual({
      kind: 'reorder',
      paneId: 'main',
      tab: alpha,
      target: beta,
    })
  })

  it('ignores a tab dropped on itself', () => {
    expect(resolveTabDrop(held(tabData('main', alpha)), held(tabData('main', alpha)))).toBeNull()
  })

  it('moves into the pane whose tab it landed on', () => {
    expect(resolveTabDrop(held(tabData('main', alpha)), held(tabData('pane-2', beta)))).toEqual({
      kind: 'move',
      tab: alpha,
      from: 'main',
      to: { paneId: 'pane-2', zone: 'center' },
    })
  })

  it('moves into a new pane when it lands on an edge zone', () => {
    const zone: ZoneDropData = { kind: 'zone', paneId: 'pane-2', zone: 'right' }
    expect(resolveTabDrop(held(tabData('main', alpha)), held(zone))).toEqual({
      kind: 'move',
      tab: alpha,
      from: 'main',
      to: { paneId: 'pane-2', zone: 'right' },
    })
  })

  it('splits a tab out of its own pane on an edge zone', () => {
    const zone: ZoneDropData = { kind: 'zone', paneId: 'main', zone: 'below' }
    expect(resolveTabDrop(held(tabData('main', alpha)), held(zone))).toEqual({
      kind: 'move',
      tab: alpha,
      from: 'main',
      to: { paneId: 'main', zone: 'below' },
    })
  })

  it('ignores the centre zone of the pane the tab already lives in', () => {
    const zone: ZoneDropData = { kind: 'zone', paneId: 'main', zone: 'center' }
    expect(resolveTabDrop(held(tabData('main', alpha)), held(zone))).toBeNull()
  })

  it('takes the centre zone of another pane', () => {
    const zone: ZoneDropData = { kind: 'zone', paneId: 'pane-2', zone: 'center' }
    expect(resolveTabDrop(held(tabData('main', alpha)), held(zone))).toEqual({
      kind: 'move',
      tab: alpha,
      from: 'main',
      to: { paneId: 'pane-2', zone: 'center' },
    })
  })

  it('ignores a drag that ended over nothing', () => {
    expect(resolveTabDrop(held(tabData('main', alpha)), null)).toBeNull()
  })

  it('ignores malformed payloads on either side', () => {
    expect(
      resolveTabDrop(held({ kind: 'tab', paneId: 'main' }), held(tabData('p', beta))),
    ).toBeNull()
    expect(
      resolveTabDrop(held(tabData('main', alpha)), held({ kind: 'zone', paneId: 'p' })),
    ).toBeNull()
    expect(
      resolveTabDrop(
        held(tabData('main', alpha)),
        held({ kind: 'zone', paneId: 'p', zone: 'top' }),
      ),
    ).toBeNull()
    expect(resolveTabDrop(held(undefined), held(tabData('p', beta)))).toBeNull()
    expect(resolveTabDrop(held(tabData('main', alpha)), held('sidebar-item'))).toBeNull()
  })

  it('ignores a tab payload whose kind is not one of ours', () => {
    expect(
      resolveTabDrop(
        held({ kind: 'tab', paneId: 'main', tab: { kind: 'sidebar-shelf', path: 'notes/a.md' } }),
        held(tabData('pane-2', beta)),
      ),
    ).toBeNull()
  })

  it('ignores a tab payload whose tab is not a tab', () => {
    expect(
      resolveTabDrop(
        held({ kind: 'tab', paneId: 'main', tab: 'notes/alpha.md' }),
        held(tabData('p', beta)),
      ),
    ).toBeNull()
  })
})

describe('dropTab', () => {
  const chatTab: OpenTab = { kind: 'chat', conversationId: 'conversation-2', pinned: false }

  function fakePanes(): { moved: unknown[]; moveTab: TabDropPanes['moveTab'] } {
    const moved: unknown[] = []
    return {
      moved,
      moveTab(tab, options) {
        moved.push({ tab, ...options })
      },
    }
  }

  function moveOf(tab: OpenTab): TabDrop {
    return { kind: 'move', tab, from: 'main', to: { paneId: 'pane-2', zone: 'center' } }
  }

  it('does nothing for a reorder or for no drop at all', () => {
    const panes = fakePanes()
    dropTab(null, { activeConversationId: null, openConversation: undefined }, panes)
    dropTab(
      { kind: 'reorder', paneId: 'main', tab: alpha, target: beta },
      { activeConversationId: null, openConversation: undefined },
      panes,
    )
    expect(panes.moved).toEqual([])
  })

  it('moves a note tab straight away', () => {
    const panes = fakePanes()
    dropTab(moveOf(alpha), { activeConversationId: null, openConversation: undefined }, panes)
    expect(panes.moved).toEqual([
      { tab: alpha, from: 'main', to: { paneId: 'pane-2', zone: 'center' } },
    ])
  })

  it('opens the conversation before moving a chat tab that is not the active one', async () => {
    const panes = fakePanes()
    const opened: string[] = []
    dropTab(
      moveOf(chatTab),
      {
        activeConversationId: 'conversation-1',
        openConversation: (id) => {
          opened.push(id)
          return Promise.resolve()
        },
      },
      panes,
    )
    expect(opened).toEqual(['conversation-2'])
    // The move waits for the session switch: the target pane navigates to
    // `{ kind: 'chat' }`, which names no conversation of its own.
    expect(panes.moved).toEqual([])
    await Promise.resolve()
    expect(panes.moved).toEqual([
      { tab: chatTab, from: 'main', to: { paneId: 'pane-2', zone: 'center' } },
    ])
  })

  it('moves a chat tab of the active conversation without reopening it', () => {
    const panes = fakePanes()
    dropTab(
      moveOf(chatTab),
      {
        activeConversationId: 'conversation-2',
        openConversation: () => Promise.reject(new Error('must not reopen')),
      },
      panes,
    )
    expect(panes.moved).toHaveLength(1)
  })

  it('moves a chat tab when no chat session is mounted', () => {
    const panes = fakePanes()
    dropTab(moveOf(chatTab), { activeConversationId: null, openConversation: undefined }, panes)
    expect(panes.moved).toHaveLength(1)
  })
})
