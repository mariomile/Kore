import { createContext, use } from 'react'
import type { AppPlatform, GraphInfo, RecentGraph } from '@reflect/core'
import type { MobileGraphBoot } from './use-mobile-graph-boot'

/** Lifecycle of the active graph (Plan 02 loading gate). */
export type GraphStatus = 'loading' | 'choosing' | 'opening' | 'ready'

/**
 * The graph context surface. The mobile-only slice (`needsOnboarding`,
 * storage roots, `completeOnboarding`) is documented on
 * {@link MobileGraphBoot}, whose hook owns it.
 */
export interface GraphContextValue extends MobileGraphBoot {
  /**
   * Which UI family the shell was built for (Plan 19's root gate), fixed at
   * boot; gates platform-only surfaces like the iOS subscription paywall.
   */
  platform: AppPlatform
  status: GraphStatus
  graph: GraphInfo | null
  recents: RecentGraph[]
  /**
   * The open **index session** generation (from `index_open`) — distinct from
   * `graph.generation` (the file-write generation): the two counters are
   * independent in Rust. Index-gated commands (`index_*`, `embed_*`,
   * `db_query` writes via the pipelines) must echo THIS one; `note_write`
   * and friends take `graph.generation`. Null when the index failed to open.
   */
  indexGeneration: number | null
  /**
   * True after this index session's first reconcile has finished and the
   * live watcher is up. Embedding backfill waits on this so a first-open
   * pass cannot hash-skip against an empty projection.
   */
  indexReady: boolean
  /** True while the background index reconcile is running (Plan 06b). */
  indexing: boolean
  error: string | null
  /**
   * True after the user picks a local (non-iCloud) folder from the OS picker.
   * The workspace then offers iCloud or GitHub sync. Recents and iCloud
   * creates never set this.
   */
  pendingLocalSyncOffer: boolean
  /** Dismiss the post-open sync offer without enabling anything. */
  dismissLocalSyncOffer: () => void
  /** Show the OS folder picker, then open (and bootstrap) the chosen graph. */
  pickAndOpen: () => Promise<void>
  /** Close the active graph and show the desktop graph chooser. */
  chooseGraph: () => Promise<void>
  /**
   * Create (and open) a graph at an app-chosen absolute path — desktop
   * onboarding's iCloud path names the folder inside the container instead
   * of showing a picker. Resolves true only on a confirmed open.
   */
  createAt: (root: string) => Promise<boolean>
  /** Open a graph by its root path. Resolves true only when it reached 'ready'. */
  openRecent: (root: string) => Promise<boolean>
  /** Drop a graph from the recents list. */
  forget: (root: string) => Promise<void>
  /**
   * Move the open graph's directory to the OS trash (recoverable), drop it
   * from recents, and return to the chooser. Throws when the delete fails so
   * the settings confirm dialog can surface the error. Desktop-only.
   */
  deleteGraph: () => Promise<void>
  /**
   * Re-run the open graph's background index reconcile. External writers the
   * watcher can't see (mobile has none; iCloud lands files behind the app's
   * back) call this after nudging downloads so arrived files get indexed.
   * No-op while no index is open.
   */
  refreshIndex: () => void
}

export const GraphContext = createContext<GraphContextValue | null>(null)

/** Access the active graph + open/choose actions. Use within a GraphProvider. */
export function useGraph(): GraphContextValue {
  const context = use(GraphContext)
  if (!context) {
    throw new Error('useGraph must be used within a GraphProvider')
  }
  return context
}
