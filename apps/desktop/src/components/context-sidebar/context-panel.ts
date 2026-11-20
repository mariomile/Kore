import { CalendarDays, Chat, Globe, Info, Terminal, type Icon } from '@/components/icons'
import type { Route } from '@/routing/route'

/** A panel the context rail can show; `details` is the one it starts with. */
export type ContextPanel = 'details' | 'chat' | 'calendar' | 'browser' | 'terminal'

/**
 * The one panel the rail always carries where the route has a subject. Every
 * other panel is opt-in through the "+" menu, so the default switcher is a
 * single tab rather than a row of five — the rail opens on what the route is
 * already about.
 */
export const DEFAULT_CONTEXT_PANEL: ContextPanel = 'details'

/** Light metadata for a context panel — shared by the expanded switcher and collapsed rail. */
export interface ContextPanelMeta {
  readonly id: ContextPanel
  readonly label: string
  readonly Glyph: Icon
}

/** Every panel the context rail can host, in canonical tab order. */
export const CONTEXT_PANEL_META: readonly ContextPanelMeta[] = [
  { id: 'details', label: 'Details', Glyph: Info },
  { id: 'chat', label: 'Chat', Glyph: Chat },
  { id: 'calendar', label: 'Calendar', Glyph: CalendarDays },
  { id: 'browser', label: 'Browser', Glyph: Globe },
  { id: 'terminal', label: 'Terminal', Glyph: Terminal },
]

const OPTIONAL_PANEL_META = CONTEXT_PANEL_META.filter((spec) => spec.id !== DEFAULT_CONTEXT_PANEL)

/**
 * The optional panels offered beside `routeKind`: the chat route already is
 * the conversation, so a Chat panel beside it would only mirror it.
 */
export function contextPanelsBeside(routeKind: Route['kind'] | undefined): ContextPanelMeta[] {
  return OPTIONAL_PANEL_META.filter((spec) => !(spec.id === 'chat' && routeKind === 'chat'))
}

/**
 * The panels currently carrying a tab on the context rail, in canonical order.
 * Shared by the expanded tab switcher and the collapsed icon strip so both
 * agree on exactly which tabs are open.
 */
export function visibleContextPanels(
  showDetails: boolean,
  opened: readonly ContextPanel[],
  routeKind: Route['kind'] | undefined,
): ContextPanelMeta[] {
  const offered = new Set(contextPanelsBeside(routeKind).map((spec) => spec.id))
  return CONTEXT_PANEL_META.filter((spec) =>
    spec.id === DEFAULT_CONTEXT_PANEL
      ? showDetails
      : opened.includes(spec.id) && offered.has(spec.id),
  )
}
