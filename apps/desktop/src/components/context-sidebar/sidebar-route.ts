import type { Route } from '@/routing/route'

/** What the AppShell's right context region should describe for a route. */
export type ContextSidebarTarget = { kind: 'daily'; date: string } | { kind: 'note'; path: string }

/**
 * The subject of the context sidebar for `route`, or `null` when the route
 * gets none: the `today` route follows the live clock, a `daily/:date` route
 * uses its date (real by the router's `normalizeRoute` invariant), a `note`
 * route uses its path, and `allNotes`/`search`/`tasks`/`chat`/`settings` routes
 * show no note context.
 */
export function contextSidebarTarget(route: Route, today: string): ContextSidebarTarget | null {
  switch (route.kind) {
    case 'today':
      return { kind: 'daily', date: today }
    case 'daily':
      return { kind: 'daily', date: route.date }
    case 'note':
    // A note's local graph page describes that note, like the note itself.
    case 'localGraph':
      return { kind: 'note', path: route.path }
    case 'allNotes':
    case 'search':
    case 'tasks':
    case 'chat':
    case 'insights':
    case 'graphMap':
    case 'settings':
    case 'graphs':
    case 'terminal':
    case 'browser':
    case 'base':
    case 'canvas':
      return null
  }
}

/**
 * Whether the Details panel has anything to say on `route`: a note or a day
 * (`target`), or All notes, whose single selected row is the side peek. Graph,
 * Tasks, Chat and the other full-page tools have neither, so the rail gives
 * their width back instead of framing an empty card.
 */
export function routeHasDetails(route: Route, target: ContextSidebarTarget | null): boolean {
  return target !== null || route.kind === 'allNotes'
}
