import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createRouterStore, type NavigateOptions, type RouterStore } from './router-store'
import type { Route } from './route'

export type { NavigateOptions } from './router-store'

interface RouterValue {
  route: Route
  /** Stable identity of the current history entry (changes on back/forward). */
  entryId: number
  /**
   * Increments on every `navigate` call — including a no-op re-navigation to
   * the current route — so views can re-anchor on explicit intent (e.g. ⌘D
   * while already on today re-scrolls the stream to today).
   */
  arrivalSeq: number
  /**
   * Read the synchronous, monotonic navigation-state revision. Unlike rendered
   * route state, this advances before `navigate`, `back`, or `forward` enqueue
   * an update (and before the current note follows a rename), so async link
   * fallbacks can detect even a same-route arrival or a back/forward round trip
   * that returned to the same history entry. A back/forward at a history
   * boundary changes nothing and does not advance it.
   */
  navigationRevision: () => number
  /**
   * True when the latest arrival asked the destination to focus its primary
   * input (`navigate(route, { focusEditor: true })`). The first today
   * arrival is focused so opening the app lands the caret in today's note.
   * Later, only explicit capture gestures request it — the mobile Daily-,
   * All-, Tasks-, and Chat-tab double-taps, desktop's ⌘D and sidebar Daily
   * notes row — while note navigations (wiki links, backlinks, back/forward)
   * stay calm so the keyboard never rises mid-arrival.
   * One-shot by construction: the next navigate overwrites it and history
   * moves clear it, so it can never leak onto a later, unrelated arrival.
   */
  arrivalFocusEditor: boolean
  navigate: (route: Route, options?: NavigateOptions) => void
  back: () => void
  forward: () => void
  canBack: boolean
  canForward: boolean
  /**
   * The route `back()` would land on — the entry just below the current one —
   * or `null` at the bottom of the stack. The mobile stack renders it beneath
   * a pushed note so the back-swipe gesture reveals a live screen.
   */
  backRoute: Route | null
  /** Record the active view's scroll offset on the current history entry. */
  saveScrollState: (offset: number) => void
  /**
   * Discard the current view's saved scroll offsets — the active history
   * entry's and, when the route belongs to a long-lived surface, the surface's
   * too — so the view re-anchors when revisited through **any** door (⌘[ back
   * or a `restoreSurfaceScroll` nav-tab return alike).
   */
  clearScrollState: () => void
  /** The current entry's recorded offset (present when revisited), or `null`. */
  savedScroll: () => number | null
}

const RouterContext = createContext<RouterValue | null>(null)

interface RouterProviderProps {
  /**
   * The store to bind. A workspace pane passes its own; the chrome passes the
   * active pane's. Omitted, the provider owns a private store for its
   * lifetime (mobile, the secondary note window, tests).
   */
  store?: RouterStore | undefined
  /** The launch route for a private store; defaults to today. */
  initialRoute?: Route | undefined
  children: ReactNode
}

/**
 * Resolve which store a render binds to. `own` is `null` exactly when a
 * `store` prop was supplied on mount, so this never falls through to
 * creating a fresh store mid-lifetime: a provider cannot switch from a
 * bound store to a private one (or back) after mounting.
 */
function resolveBoundStore(store: RouterStore | undefined, own: RouterStore | null): RouterStore {
  if (store !== undefined) {
    return store
  }
  if (own === null) {
    throw new Error('RouterProvider cannot switch from a bound store to a private one')
  }
  return own
}

/**
 * Bind a {@link RouterStore} to the router context (Plan 06). Every consumer
 * keeps calling `useRouter()`; which pane it addresses is decided by the
 * nearest provider's store.
 */
export function RouterProvider({
  store,
  initialRoute,
  children,
}: RouterProviderProps): ReactElement {
  const [own] = useState(() => (store === undefined ? createRouterStore(initialRoute) : null))
  const bound = resolveBoundStore(store, own)
  useEffect(() => (own === null ? undefined : own.connect()), [own])
  const snapshot = useSyncExternalStore(bound.subscribe, bound.getSnapshot, bound.getSnapshot)
  const value = useMemo<RouterValue>(
    () => ({
      ...snapshot,
      navigationRevision: bound.navigationRevision,
      navigate: bound.navigate,
      back: bound.back,
      forward: bound.forward,
      saveScrollState: bound.saveScrollState,
      clearScrollState: bound.clearScrollState,
      savedScroll: bound.savedScroll,
    }),
    [snapshot, bound],
  )
  return <RouterContext value={value}>{children}</RouterContext>
}

/** Access the current route + navigation. Use within a RouterProvider. */
export function useRouter(): RouterValue {
  const context = use(RouterContext)
  if (!context) {
    throw new Error('useRouter must be used within a RouterProvider')
  }
  return context
}

/**
 * Read the router's synchronous navigation-revision getter when a provider is
 * present. Low-level rendered-link hooks use the nullable form so their
 * standalone component harnesses remain valid outside a full app router.
 */
export function useNavigationRevision(): (() => number) | null {
  return use(RouterContext)?.navigationRevision ?? null
}

interface RouterFreezeProps {
  /** While true, the subtree keeps the last router value it saw unfrozen. */
  frozen: boolean
  children: ReactNode
}

/**
 * Pin the router value a subtree sees while it is in the background. The
 * mobile stack keeps the screen `back()` would reveal mounted (hidden and
 * inert) beneath a note — without this, that screen would still observe
 * every navigation: a note push bumps `arrivalSeq`, which the daily surface
 * reads as a re-arrival and re-anchors its scroll while nobody is looking.
 * Frozen subtrees resume the live value the moment they surface again; the
 * navigation callbacks in the frozen snapshot stay valid because they are
 * stable for the provider's lifetime.
 */
export function RouterFreeze({ frozen, children }: RouterFreezeProps): ReactElement {
  const live = useRouter()
  // The capture tracks the live value only while unfrozen — state adjusted
  // during render, so freezing pins exactly what the last unfrozen commit saw.
  const [captured, setCaptured] = useState(live)
  if (!frozen && captured !== live) {
    setCaptured(live)
  }
  return <RouterContext value={frozen ? captured : live}>{children}</RouterContext>
}
