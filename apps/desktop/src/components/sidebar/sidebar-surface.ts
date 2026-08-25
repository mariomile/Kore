/**
 * The workspace sidebar's top-level surfaces (Plan: sidebar restructure):
 * Home carries the classic navigation and shelves, Chat the AI conversation
 * list, Meetings the coming week's calendar events. The selection persists
 * per session (same policy as the disclosure shelves) so the rail stays where
 * the user left it while navigating.
 */

export type SidebarSurface = 'home' | 'chat' | 'meetings'

const STORAGE_KEY = 'reflect.workspace-sidebar.surface'

/** Type guard over the persisted (and therefore untrusted) surface value. */
function isSidebarSurface(value: string | null): value is SidebarSurface {
  return value === 'home' || value === 'chat' || value === 'meetings'
}

/** The session's persisted surface; Home when nothing (valid) is stored. */
export function readSidebarSurface(): SidebarSurface {
  const stored = window.sessionStorage.getItem(STORAGE_KEY)
  return isSidebarSurface(stored) ? stored : 'home'
}

/** Persist the selected surface for the session. */
export function storeSidebarSurface(surface: SidebarSurface): void {
  window.sessionStorage.setItem(STORAGE_KEY, surface)
}
