import { describe, expect, it } from 'vitest'
import type { OpenTab } from '@reflect/core'
import { resolveTabDrop, zoneDropId, type TabDragData, type ZoneDropData } from '@/lib/tab-drop'

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

  it('ignores a tab payload whose tab is not a tab', () => {
    expect(
      resolveTabDrop(
        held({ kind: 'tab', paneId: 'main', tab: 'notes/alpha.md' }),
        held(tabData('p', beta)),
      ),
    ).toBeNull()
  })
})
