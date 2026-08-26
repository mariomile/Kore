import {
  isDaily,
  isTemplatePath,
  isUntitledNotePath,
  type OpenTab,
  type WorkspaceSurface,
} from '@reflect/core'
import { routeForPath, type Route } from '@/routing/route'

/**
 * Identity of a strip tab, stable across pin toggles. Notes key on path;
 * each workspace surface (Settings, Browser, …) has at most one tab.
 */
export function tabKey(tab: OpenTab): string {
  return tab.kind === 'note' ? `note:${tab.path}` : `surface:${tab.surface}`
}

/** True when two tabs address the same note or the same surface. */
export function tabsEqual(left: OpenTab, right: OpenTab): boolean {
  return tabKey(left) === tabKey(right)
}

/**
 * Whether a note path belongs in the tab set at all. Daily notes are tab
 * zero; templates are edited, not "open"; an untitled placeholder is
 * mid-birth-rename — its permanent path joins once named.
 */
export function isTabbableNotePath(path: string): boolean {
  return !isDaily(path) && !isTemplatePath(path) && !isUntitledNotePath(path)
}

/**
 * The tab a route opens (or focuses), or null for Daily, search, and other
 * screens that are not strip tabs. Newly opened tabs are unpinned.
 */
export function openTabForRoute(route: Route): OpenTab | null {
  switch (route.kind) {
    case 'note':
      return isTabbableNotePath(route.path)
        ? { kind: 'note', path: route.path, pinned: false }
        : null
    case 'settings':
    case 'browser':
    case 'tasks':
    case 'chat':
    case 'terminal':
    case 'insights':
    case 'graphMap':
    case 'agents':
      return { kind: 'surface', surface: route.kind, pinned: false }
    case 'allNotes':
      return { kind: 'surface', surface: 'allNotes', pinned: false }
    case 'today':
    case 'daily':
    case 'search':
    case 'graphs':
      return null
  }
}

/** Navigate target for a tab click. Surfaces restore their canonical route. */
export function routeForOpenTab(tab: OpenTab): Route {
  if (tab.kind === 'note') {
    return routeForPath(tab.path)
  }
  switch (tab.surface) {
    case 'settings':
      return { kind: 'settings' }
    case 'browser':
      return { kind: 'browser' }
    case 'tasks':
      return { kind: 'tasks' }
    case 'chat':
      return { kind: 'chat' }
    case 'terminal':
      return { kind: 'terminal' }
    case 'insights':
      return { kind: 'insights' }
    case 'graphMap':
      return { kind: 'graphMap' }
    case 'agents':
      return { kind: 'agents' }
    case 'allNotes':
      return { kind: 'allNotes', tag: null }
  }
}

/** Strip (and tooltip) labels for workspace-surface tabs. */
export const SURFACE_TAB_LABEL: Record<WorkspaceSurface, string> = {
  settings: 'Settings',
  browser: 'Browser',
  tasks: 'Tasks',
  chat: 'Chat',
  terminal: 'Terminal',
  allNotes: 'All notes',
  insights: 'Insights',
  graphMap: 'Graph',
  agents: 'Agents',
}
