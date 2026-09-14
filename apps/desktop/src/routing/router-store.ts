import { isMobileSurface } from '@/lib/platform-surface'
import { onNoteMoved } from '@/lib/note-moves'
import { normalizeRoute, routesEqual, type Route } from './route'

/**
 * The router's state as a plain external store (Plan 06 history semantics,
 * lifted out of React so one store can back several `RouterProvider`
 * bindings: a pane's own subtree and the workspace chrome bound to the
 * active pane). Behaviour is unchanged from the previous provider: `navigate`
 * pushes and truncates forward entries, `back`/`forward` move the cursor,
 * history entries carry scroll offsets, long-lived surfaces keep a surface
 * offset, and a note move rewrites every entry pointing at the old path.
 */

export interface NavigateOptions {
  /** Seed the new entry with the target surface's last saved scroll offset. */
  restoreSurfaceScroll?: boolean
  /** Ask the destination to focus its primary input on arrival. */
  focusEditor?: boolean
}

export interface RouterSnapshot {
  readonly route: Route
  readonly entryId: number
  readonly arrivalSeq: number
  readonly arrivalFocusEditor: boolean
  readonly canBack: boolean
  readonly canForward: boolean
  readonly backRoute: Route | null
}

export interface RouterStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): RouterSnapshot
  navigate(route: Route, options?: NavigateOptions): void
  back(): void
  forward(): void
  /** Synchronous, monotonic navigation-state revision. */
  navigationRevision(): number
  saveScrollState(offset: number): void
  clearScrollState(): void
  savedScroll(): number | null
  /** Stop following note moves. Call once the store's pane is gone. */
  dispose(): void
}

interface HistoryEntry {
  id: number
  route: Route
}

function scrollSurfaceForRoute(route: Route): string | null {
  switch (route.kind) {
    case 'today':
    case 'daily':
      return 'daily'
    default:
      return null
  }
}

export function createRouterStore(initialRoute: Route = { kind: 'today' }): RouterStore {
  let stack: HistoryEntry[] = [{ id: 0, route: normalizeRoute(initialRoute) }]
  let index = 0
  let arrivalSeq = 0
  // Desktop open-on-today puts the caret in the daily note; mobile keeps the
  // keyboard down until an explicit capture gesture.
  let arrivalFocusEditor = !isMobileSurface() && stack[0]!.route.kind === 'today'
  let nextId = 1
  let revision = 0
  const scrollById = new Map<number, number>()
  const scrollBySurface = new Map<string, number>()
  const listeners = new Set<() => void>()

  function current(): HistoryEntry {
    return stack[index]!
  }

  function buildSnapshot(): RouterSnapshot {
    const entry = current()
    return {
      route: entry.route,
      entryId: entry.id,
      arrivalSeq,
      arrivalFocusEditor,
      canBack: index > 0,
      canForward: index < stack.length - 1,
      backRoute: index > 0 ? stack[index - 1]!.route : null,
    }
  }

  let snapshot = buildSnapshot()

  function emit(): void {
    snapshot = buildSnapshot()
    for (const listener of listeners) {
      listener()
    }
  }

  function navigate(route: Route, options?: NavigateOptions): void {
    revision += 1
    const target = normalizeRoute(route)
    const surface = scrollSurfaceForRoute(target)
    const returning =
      options?.restoreSurfaceScroll === true &&
      surface !== null &&
      scrollSurfaceForRoute(current().route) !== surface
    const restored = returning ? scrollBySurface.get(surface) : undefined
    if (surface !== null && restored === undefined) {
      scrollBySurface.delete(surface)
    }
    const entry = current()
    if (routesEqual(entry.route, target)) {
      if (restored !== undefined) {
        scrollById.set(entry.id, restored)
      } else {
        scrollById.delete(entry.id)
      }
    } else if (entry.route.kind === 'settings' && target.kind === 'settings') {
      stack = stack.map((item, position) =>
        position === index ? { ...item, route: target } : item,
      )
    } else {
      for (const dropped of stack.slice(index + 1)) {
        scrollById.delete(dropped.id)
      }
      const id = nextId++
      if (restored !== undefined) {
        scrollById.set(id, restored)
      }
      stack = [...stack.slice(0, index + 1), { id, route: target }]
      index = stack.length - 1
    }
    arrivalSeq += 1
    arrivalFocusEditor = options?.focusEditor === true
    emit()
  }

  function back(): void {
    if (index === 0) {
      return
    }
    revision += 1
    arrivalFocusEditor = false
    index -= 1
    emit()
  }

  function forward(): void {
    if (index >= stack.length - 1) {
      return
    }
    revision += 1
    arrivalFocusEditor = false
    index += 1
    emit()
  }

  const stopFollowingMoves = onNoteMoved((from, to) => {
    const entry = current()
    if (entry.route.kind === 'note' && entry.route.path === from) {
      revision += 1
    }
    let changed = false
    stack = stack.map((entry) => {
      if (entry.route.kind === 'note' && entry.route.path === from) {
        changed = true
        return { ...entry, route: { kind: 'note' as const, path: to } }
      }
      return entry
    })
    if (changed) {
      emit()
    }
  })

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    navigate,
    back,
    forward,
    navigationRevision: () => revision,
    saveScrollState(offset) {
      scrollById.set(current().id, offset)
      const surface = scrollSurfaceForRoute(current().route)
      if (surface !== null) {
        scrollBySurface.set(surface, offset)
      }
    },
    clearScrollState() {
      scrollById.delete(current().id)
      const surface = scrollSurfaceForRoute(current().route)
      if (surface !== null) {
        scrollBySurface.delete(surface)
      }
    },
    savedScroll: () => scrollById.get(current().id) ?? null,
    dispose: stopFollowingMoves,
  }
}
