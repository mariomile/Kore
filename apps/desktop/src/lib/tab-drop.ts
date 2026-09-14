import { z } from 'zod'
import type { OpenTab } from '@reflect/core'
import { tabsEqual } from '@/providers/open-tab'
import type { DropZone } from '@/providers/panes-provider'

/**
 * What a tab drag means (split panes design, 2026-09-14, part 2). One
 * `DndContext` at the workspace frame sees every strip and every pane, so the
 * same drag-end event can mean "reorder this strip" or "move this tab into
 * that pane". Both payloads come off dnd-kit as `unknown`, and both are
 * validated here rather than trusted: the frame also sees drags the sidebar
 * never meant for it.
 */

/** A dragging tab pill: which pane it comes from, and which tab it is. */
export interface TabDragData {
  readonly kind: 'tab'
  readonly paneId: string
  readonly tab: OpenTab
}

/** One of a pane's three drop regions. */
export interface ZoneDropData {
  readonly kind: 'zone'
  readonly paneId: string
  readonly zone: DropZone
}

export type TabDrop =
  | {
      readonly kind: 'reorder'
      readonly paneId: string
      readonly tab: OpenTab
      readonly target: OpenTab
    }
  | {
      readonly kind: 'move'
      readonly tab: OpenTab
      readonly from: string
      readonly to: { paneId: string; zone: DropZone }
    }

/** The droppable id of one pane zone. Unique per pane, and parseable by prefix. */
export function zoneDropId(paneId: string, zone: DropZone): string {
  return `zone:${paneId}:${zone}`
}

// `@reflect/core` keeps its tab schema internal, so the payload is checked for
// the one thing that makes it a tab, its `kind` discriminant, and typed from
// the sortable's own declaration.
const tabShapeSchema = z.object({ kind: z.enum(['note', 'chat', 'surface']) })
const openTabValueSchema = z.custom<OpenTab>((value) => tabShapeSchema.safeParse(value).success)

const tabDragSchema = z.object({
  kind: z.literal('tab'),
  paneId: z.string().min(1),
  tab: openTabValueSchema,
})

const zoneDropSchema = z.object({
  kind: z.literal('zone'),
  paneId: z.string().min(1),
  zone: z.enum(['center', 'right', 'below']),
})

const dataRefSchema = z.object({ current: z.unknown() })

/** The payload dnd-kit parked behind a draggable's or droppable's data ref. */
function payloadOf(holder: { data: unknown }): unknown {
  const ref = dataRefSchema.safeParse(holder.data)
  return ref.success ? ref.data.current : undefined
}

/**
 * Map a drag-end event to the one thing it asks for, or null when it asks for
 * nothing: a tab dropped on itself, a drag that ended over empty space, a
 * pane's own centre (where the tab already is), or a payload from somewhere
 * else entirely.
 */
export function resolveTabDrop(
  active: { data: unknown },
  over: { data: unknown } | null,
): TabDrop | null {
  const drag = tabDragSchema.safeParse(payloadOf(active))
  if (!drag.success || over === null) {
    return null
  }
  const payload = payloadOf(over)

  const zone = zoneDropSchema.safeParse(payload)
  if (zone.success) {
    if (zone.data.zone === 'center' && zone.data.paneId === drag.data.paneId) {
      return null
    }
    return {
      kind: 'move',
      tab: drag.data.tab,
      from: drag.data.paneId,
      to: { paneId: zone.data.paneId, zone: zone.data.zone },
    }
  }

  const target = tabDragSchema.safeParse(payload)
  if (!target.success) {
    return null
  }
  if (target.data.paneId !== drag.data.paneId) {
    // A pill of another strip stands for that pane's centre.
    return {
      kind: 'move',
      tab: drag.data.tab,
      from: drag.data.paneId,
      to: { paneId: target.data.paneId, zone: 'center' },
    }
  }
  if (tabsEqual(drag.data.tab, target.data.tab)) {
    return null
  }
  return { kind: 'reorder', paneId: drag.data.paneId, tab: drag.data.tab, target: target.data.tab }
}

/** What `dropTab` needs of the chat session: nothing else of it is its business. */
export interface TabDropChat {
  readonly activeConversationId: string | null
  readonly openConversation: ((id: string) => Promise<void>) | undefined
}

/** What `dropTab` needs of the pane model. */
export interface TabDropPanes {
  moveTab(tab: OpenTab, options: { from: string; to: { paneId: string; zone: DropZone } }): void
}

/**
 * Carry out a resolved drop. A reorder is the strip's own business (it
 * monitors the same drag-end event), so only a move lands here. A chat tab
 * carries a conversation id but its route does not, so the session is
 * switched *before* the move: the target pane navigates to `{ kind: 'chat' }`
 * and would otherwise show whichever conversation was already active.
 */
export function dropTab(drop: TabDrop | null, chat: TabDropChat, panes: TabDropPanes): void {
  if (drop?.kind !== 'move') {
    return
  }
  const { tab } = drop
  if (
    tab.kind === 'chat' &&
    tab.conversationId !== chat.activeConversationId &&
    chat.openConversation !== undefined
  ) {
    const open = chat.openConversation
    void open(tab.conversationId).then(() => {
      panes.moveTab(tab, { from: drop.from, to: drop.to })
    })
    return
  }
  panes.moveTab(tab, { from: drop.from, to: drop.to })
}
