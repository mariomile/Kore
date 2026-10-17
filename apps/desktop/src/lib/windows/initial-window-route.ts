import { isDaily, isNotePath } from '@reflect/core'
import { parseDeepLink } from '@/lib/deep-links/parse'
import { routeForPath, type Route } from '@/routing/route'

/**
 * A note window's first route, derived from its initial deep link BEFORE the
 * router mounts — so the window's first workspace render is already the
 * ⌘-clicked note instead of flashing today's daily note while the link rides
 * the async intake. Set by the boot hook, read by the workspace when it
 * mounts the router. Plain slot, not consume-once: a webview boots once, and
 * idempotent reads survive StrictMode's double-invoked initializers.
 */

let initialRoute: Route | null = null

/** Record the derived first route (the boot hook, before status flips ready). */
export function setInitialWindowRoute(route: Route): void {
  initialRoute = route
}

/** The derived first route, or null (main window, reload, unresolvable link). */
export function getInitialWindowRoute(): Route | null {
  return initialRoute
}

/**
 * Derive a route from a `kore://` link synchronously, or null when only
 * the index can answer. ⌘-click builds links with `deepLinkForRoute`, so its
 * note targets are path-shaped and resolve right here; id/title-shaped
 * targets (hand-written links) fall back to the intake's async resolution —
 * those windows briefly show today, the price of an index round-trip.
 */
export function initialRouteForDeepLink(link: string | null): Route | null {
  if (link === null) {
    return null
  }
  const parsed = parseDeepLink(link)
  if (parsed === null) {
    return null
  }
  if (parsed.kind === 'navigate') {
    return parsed.route
  }
  if (parsed.kind === 'openNote' && (isNotePath(parsed.target) || isDaily(parsed.target))) {
    return routeForPath(parsed.target)
  }
  return null
}

/** Test-only: reset the slot between cases. */
export function resetInitialWindowRouteForTests(): void {
  initialRoute = null
}
