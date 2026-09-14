import {
  createContext,
  use,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  contextSidebarTarget,
  type ContextSidebarTarget,
} from '@/components/context-sidebar/sidebar-route'
import { useToday } from '@/lib/use-today'
import { createValueStore, type ValueStore } from '@/lib/value-store'
import { effectiveDailyDate } from '@/routing/route'
import { useRouter } from '@/routing/router'

/**
 * Which day in the daily stream currently holds the user's focus, so the
 * context sidebar can describe *that* day rather than the routed one.
 *
 * The daily stream is a run of per-day editors under a single `daily/:date`
 * route: scrolling or clicking to another day moves focus but never changes the
 * route (only the calendar does). Without this, the right sidebar — derived
 * purely from the route — stays pinned to the routed day while the user edits a
 * different one, so its note actions (pin, private, publish) and the published
 * URL all describe the wrong note.
 *
 * The stream is the only writer (it sets the focused day on focus); the
 * workspace shell reads it and falls back to the routed day when nothing in the
 * stream is focused — which is also the calendar-pick path. Split into separate
 * value/setter contexts so the heavy stream can consume the (stable) setter
 * without re-rendering every time the focused day changes.
 */

const FocusedDailyDateContext = createContext<string | null>(null)
const SetFocusedDailyDateContext = createContext<(date: string | null) => void>(() => {})

interface FocusedDailyProviderProps {
  /** Shared with the pane's chrome binding; omitted, the provider owns one. */
  store?: ValueStore<string | null> | undefined
  children: ReactNode
}

/**
 * Resolve which store a render binds to. `own` is `null` exactly when a
 * `store` prop was supplied on mount, so this never falls through to
 * creating a fresh store mid-lifetime: a provider cannot switch from a
 * bound store to a private one (or back) after mounting.
 */
function resolveBoundStore(
  store: ValueStore<string | null> | undefined,
  own: ValueStore<string | null> | null,
): ValueStore<string | null> {
  if (store !== undefined) {
    return store
  }
  if (own === null) {
    throw new Error('FocusedDailyProvider cannot switch from a bound store to a private one')
  }
  return own
}

/** Provides the focused-day state to the workspace shell and the daily stream. */
export function FocusedDailyProvider({ store, children }: FocusedDailyProviderProps): ReactElement {
  const [own] = useState(() => (store === undefined ? createValueStore<string | null>(null) : null))
  const bound = resolveBoundStore(store, own)
  const focusedDate = useSyncExternalStore(bound.subscribe, bound.get, bound.get)
  return (
    <SetFocusedDailyDateContext value={bound.set}>
      <FocusedDailyDateContext value={focusedDate}>{children}</FocusedDailyDateContext>
    </SetFocusedDailyDateContext>
  )
}

/** The focused day, or `null` when nothing in the stream is focused. */
export function useFocusedDailyDate(): string | null {
  return use(FocusedDailyDateContext)
}

/** Record (or clear, with `null`) the focused day. No-op without a provider. */
export function useSetFocusedDailyDate(): (date: string | null) => void {
  return use(SetFocusedDailyDateContext)
}

/**
 * The context-sidebar target for the current route, following the day focused
 * in the daily stream and snapping back to the routed subject on navigation.
 *
 * On a daily view the sidebar describes the focused day, not the routed one (the
 * stream keeps a single `daily/:date` route as focus moves between days) — the
 * {@link effectiveDailyDate} precedence the note-scoped commands share. Focus
 * deliberately *stays* through transient moves — opening ⌘K, clicking a sidebar
 * button — rather than flicking back and out again: what restores the routed day
 * is navigation, not blur. So the reset keys off the same signals the stream
 * re-anchors on (`arrivalSeq`/`entryId`), not the routed date, so re-targeting
 * the current day (a calendar pick on it, ⌘D to today) snaps back too. It runs
 * pre-paint (a layout effect) so no stale day shows before the stream re-focuses
 * the target; with nothing focused it is just the routed subject.
 */
export function useDailyContextTarget(): ContextSidebarTarget | null {
  const { route, arrivalSeq, entryId } = useRouter()
  const today = useToday()
  const focusedDailyDate = useFocusedDailyDate()
  const setFocusedDailyDate = useSetFocusedDailyDate()
  useLayoutEffect(() => {
    setFocusedDailyDate(null)
  }, [arrivalSeq, entryId, setFocusedDailyDate])
  const daily = effectiveDailyDate(route, today, focusedDailyDate)
  return daily !== null ? { kind: 'daily', date: daily } : contextSidebarTarget(route, today)
}
