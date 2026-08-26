import { isDaily, isTemplatePath, type OpenTab, type WorkspaceSurface } from '@reflect/core'
import { routeForPath, routesEqual, type Route } from '@/routing/route'

/**
 * Identity of a strip tab, stable across pin toggles and mutable route state.
 * Notes key on path, chats on conversation id, and each workspace surface has
 * at most one tab.
 */
export function tabKey(tab: OpenTab): string {
  switch (tab.kind) {
    case 'note':
      return `note:${tab.path}`
    case 'chat':
      return `chat:${tab.conversationId}`
    case 'surface':
      return `surface:${tab.surface}`
  }
}

/** True when two tabs address the same note, conversation, or surface. */
export function tabsEqual(left: OpenTab, right: OpenTab): boolean {
  return tabKey(left) === tabKey(right)
}

/** True when identity, route payload, and pin state are all unchanged. */
export function tabStateEqual(left: OpenTab, right: OpenTab): boolean {
  return (
    tabsEqual(left, right) &&
    left.pinned === right.pinned &&
    routesEqual(routeForOpenTab(left), routeForOpenTab(right))
  )
}

/** Apply the latest route payload without losing an existing pin. */
export function updateOpenTabRoute(current: OpenTab, incoming: OpenTab): OpenTab {
  return { ...incoming, pinned: current.pinned }
}

/**
 * Whether a note path belongs in the tab set at all. Daily notes use the
 * singleton Daily surface; templates are managed inside Settings. Untitled
 * notes intentionally join immediately and follow their birth rename later.
 */
export function isTabbableNotePath(path: string): boolean {
  return !isDaily(path) && !isTemplatePath(path)
}

/**
 * The tab a route opens or focuses. Chat identity lives in ChatProvider rather
 * than the router, so callers provide the active conversation id.
 */
export function openTabForRoute(
  route: Route,
  conversationId: string | null = null,
): OpenTab | null {
  switch (route.kind) {
    case 'note':
      return isTabbableNotePath(route.path)
        ? { kind: 'note', path: route.path, pinned: false }
        : null
    case 'today':
      return { kind: 'surface', surface: 'daily', date: null, pinned: false }
    case 'daily':
      return { kind: 'surface', surface: 'daily', date: route.date, pinned: false }
    case 'allNotes':
      return { kind: 'surface', surface: 'allNotes', tag: route.tag, pinned: false }
    case 'search':
      return { kind: 'surface', surface: 'search', query: route.query, pinned: false }
    case 'chat':
      return conversationId === null ? null : { kind: 'chat', conversationId, pinned: false }
    case 'tasks':
    case 'insights':
    case 'graphMap':
    case 'agents':
    case 'settings':
    case 'terminal':
    case 'browser':
      return { kind: 'surface', surface: route.kind, pinned: false }
    case 'graphs':
      return { kind: 'surface', surface: 'settings', pinned: false }
  }
}

/** Navigate target for a tab click. */
export function routeForOpenTab(tab: OpenTab): Route {
  if (tab.kind === 'note') {
    return routeForPath(tab.path)
  }
  if (tab.kind === 'chat') {
    return { kind: 'chat' }
  }
  switch (tab.surface) {
    case 'daily':
      return tab.date === null ? { kind: 'today' } : { kind: 'daily', date: tab.date }
    case 'allNotes':
      return { kind: 'allNotes', tag: tab.tag }
    case 'search':
      return { kind: 'search', query: tab.query }
    case 'tasks':
      return { kind: 'tasks' }
    case 'insights':
      return { kind: 'insights' }
    case 'graphMap':
      return { kind: 'graphMap' }
    case 'agents':
      return { kind: 'agents' }
    case 'settings':
      return { kind: 'settings' }
    case 'terminal':
      return { kind: 'terminal' }
    case 'browser':
      return { kind: 'browser' }
  }
}

/** Strip (and tooltip) labels for workspace-surface tabs. */
export const SURFACE_TAB_LABEL: Record<WorkspaceSurface, string> = {
  daily: 'Daily notes',
  allNotes: 'All notes',
  search: 'Search',
  tasks: 'Tasks',
  insights: 'Insights',
  graphMap: 'Graph',
  agents: 'Agents',
  settings: 'Settings',
  terminal: 'Terminal',
  browser: 'Browser',
}
