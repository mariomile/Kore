import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  deleteGraph as deleteGraphCommand,
  errorMessage,
  forgetRecent,
  hasBridge,
  icloudRequestDownloads,
  isMobilePlatform,
  createGraph,
  openGraph,
  recentGraphs,
  type AppPlatform,
  type GraphInfo,
  type RecentGraph,
} from '@reflect/core'
import { followHealedMove } from '@/editor/move-note'
import { resetNoteRowOverlays } from '@/hooks/note-row-overlay'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { isICloudRoot } from '@/lib/icloud-controller'
import { setIndexProgress } from '@/lib/index-progress'
import {
  dropIcloudStatusQuery,
  dropSimilarNotesQueries,
  throttledInvalidateIndexQueries,
} from '@/lib/query-client'
import { ensureFirstRunSeeds } from '@/lib/welcome-note'
import { closeSecondaryWindows } from '@/lib/windows/close-secondary-windows'
import { isMainWindow, requireMainWindow } from '@/lib/windows/window-role'
import { GraphContext, type GraphContextValue, type GraphStatus } from './graph-context'
import { createGraphIndex } from './graph-index'
import { pickerDefaultPath } from './graph-provider-helpers'
import { useDesktopGraphBoot } from './use-desktop-graph-boot'
import { useMobileGraphBoot } from './use-mobile-graph-boot'
import { useNoteWindowBoot } from './use-note-window-boot'
import { useReconcileRequests } from './use-reconcile-requests'

export { useGraph, type GraphStatus } from './graph-context'

/**
 * Owns the active graph and the open/choose flow. On mount it auto-opens the
 * most-recent graph (so the app reopens where you left off) and otherwise shows
 * the chooser. All durable file access goes through `@reflect/core` commands.
 *
 * On mobile (Plans 19/21) there is no chooser and no recents-driven reopen:
 * the graph lives in one of two fixed roots — the app's iCloud Drive
 * container (the recommended default; syncs across devices) or the app
 * sandbox `Documents/` — and only the *kind* is persisted. Absolute paths are
 * **derived fresh every launch** because iOS container paths change across
 * restore/update, so a persisted recent would point at a dead path.
 * `platform` selects the bootstrap; everything downstream of the open is
 * shared.
 */
export function GraphProvider({
  children,
  platform = 'desktop',
}: {
  children: ReactNode
  platform?: AppPlatform
}) {
  const bridgeReady = useBridgeReady()
  const [status, setStatus] = useState<GraphStatus>('loading')
  const [graph, setGraph] = useState<GraphInfo | null>(null)
  const [recents, setRecents] = useState<RecentGraph[]>([])
  const [indexing, setIndexing] = useState(false)
  const [indexGeneration, setIndexGeneration] = useState<number | null>(null)
  const [indexReady, setIndexReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingLocalSyncOffer, setPendingLocalSyncOffer] = useState(false)
  // The latest graph root requested via `openRecent` — `pickAndOpen` only
  // raises the sync offer when this still matches the folder it picked, so a
  // later recents/create switch cannot inherit the prompt.
  const latestOpenRoot = useRef<string | null>(null)
  // Monotonic open token: only the most recent open may commit `graph`/`status`,
  // so overlapping opens (double-click, StrictMode remount) can't finish out of
  // order and leave us on a graph the user didn't pick last.
  const openSeq = useRef(0)
  // Serializes backend opens (see `openRecent`).
  const openChain = useRef<Promise<unknown>>(Promise.resolve())
  // The active graph's index lifecycle (open → reconcile → subscribe → watch), so
  // a graph switch can stop the prior pass before the Rust connection is swapped.
  const indexRef = useRef(
    createGraphIndex({
      onError: (stage, err) => console.error(`index ${stage} failed:`, errorMessage(err)),
      onProgress: (progress) => {
        setIndexing(progress === 'reconciling')
        if (progress === 'live') {
          setIndexReady(true)
        }
        if (progress !== 'reconciling') {
          setIndexProgress(null) // the pass finished (or went idle) — clear the pill
        }
      },
      // Applied watcher batches stream every couple of seconds during a bulk
      // sync — the throttled variant collapses them to one refetch round per
      // window (an isolated batch still invalidates immediately).
      onApplied: throttledInvalidateIndexQueries,
      onFileProgress: (done, total, worked) => setIndexProgress({ done, total, worked }),
      // External renames healed by id follow through to sessions and routes,
      // exactly as for an in-app rename (Plan 17).
      onMoved: followHealedMove,
      // iCloud-evicted notes whose content the index lacks (never indexed
      // here, or remote-edited while evicted): request exactly those
      // downloads; the materialized files index via ordinary watcher
      // upserts. Non-iCloud graphs never list placeholders, so this never
      // fires for them. Rust resolves against the active root itself.
      onStalePlaceholders: (paths) => {
        icloudRequestDownloads(paths).catch((err: unknown) => {
          console.error('iCloud download request failed:', errorMessage(err))
        })
      },
      // `visibilitychange` below performs the active teardown; this dynamic
      // guard also closes the launch race where the first sync is scheduled
      // after iOS has already hidden the webview.
      shouldSuspend: () => isMobilePlatform(platform) && document.visibilityState === 'hidden',
    }),
  )

  useEffect(() => {
    if (!isMobilePlatform(platform) || !isMainWindow()) {
      return
    }

    const index = indexRef.current
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        // Synchronous teardown prevents a locally emitted or metadata-watcher
        // batch from entering the index queue after iOS begins suspension.
        index.suspend()
        return
      }
      const seq = openSeq.current
      // A null generation still clears suspension: mobile can foreground
      // before onboarding/open has produced an index session. With a session,
      // the full pass recovers every event missed while hidden; stacked
      // resume/iCloud triggers fold into the lifecycle's queued rerun.
      index.resume(indexGeneration, () => seq !== openSeq.current)
    }

    if (document.visibilityState === 'hidden') {
      index.suspend()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [indexGeneration, platform])

  const loadRecents = useCallback(
    // Call-time check on purpose: an imperative load reads the live bridge
    // state, and a captured value would churn this callback's identity (and
    // every boot effect downstream of it) on install/teardown.
    async (options?: { surfaceErrors?: boolean }): Promise<RecentGraph[]> => {
      if (!hasBridge()) {
        return [] // bridgeless browser dev — there's no backend store to read.
      }
      try {
        const list = await recentGraphs()
        setRecents(list)
        return list
      } catch (err) {
        // Surface a real failure (e.g. a corrupt recent-graphs.json, which Rust
        // reports as an error rather than an empty list) only when this is the
        // primary load. As a post-open refresh it must not clobber an open error
        // or set one on a screen (the workspace) that never shows it.
        if (options?.surfaceErrors) {
          setError(errorMessage(err))
        }
        return []
      }
    },
    [],
  )

  const openRecent = useCallback(
    (root: string): Promise<boolean> => {
      if (!requireMainWindow('opening a graph')) {
        return Promise.resolve(false)
      }
      latestOpenRoot.current = root
      // Recents, iCloud creates, and adopt-reopens all go through here — none
      // of them should keep a leftover "you just picked a local folder" offer.
      setPendingLocalSyncOffer(false)
      const seq = ++openSeq.current
      setStatus('opening')
      setError(null)
      // Resolves true only when this open actually reached 'ready' — callers
      // (mobile onboarding) gate side effects like persisting the onboarded
      // flag on a confirmed open, never on a clone that failed to open.
      const run = async (): Promise<boolean> => {
        let opened = false
        try {
          await closeSecondaryWindows(platform) // before openGraph bumps the session
          const info = await openGraph(root)
          if (seq !== openSeq.current) {
            return false // superseded by a newer open
          }
          const index = indexRef.current
          // Stop any prior reconcile and wait for it to fully settle before the
          // Rust index connection is swapped, so a stale pass can't write into
          // this graph's index.
          await index.stop()
          // Reclaim the prior graph's optimistic note-row overlays and its
          // session-held "Similar notes" results. Both are already invisible
          // here (scoped by generation / graph root), so this is memory
          // hygiene, not correctness.
          resetNoteRowOverlays()
          dropSimilarNotesQueries()
          // Open the index *before* 'ready' so reads can't hit the previous
          // graph's index. Best-effort: an index failure doesn't block editing.
          const generation = await index.open()
          if (seq !== openSeq.current) {
            return false
          }
          // Transition to 'ready' immediately — the user can start editing.
          setGraph(info)
          setIndexGeneration(generation)
          setIndexReady(false)
          setStatus('ready')
          opened = true
          // Onboarding, considered exactly once per graph (the per-seed meta
          // markers): an empty graph gets the pinned "How to use Kore" note
          // and the default objects (Project, Person, Company, Meeting).
          // Needs the index for the markers, so a graph whose index failed
          // to open simply tries again next time. On all launches after the
          // first, ensureFirstRunSeeds returns immediately (markers set),
          // so it no longer blocks time-to-first-workspace-paint. The seeds
          // must land before the reconcile indexes files — index.sync starts
          // in the .finally so it always runs after the seed attempt.
          // Best-effort — a failed seed must never block opening.
          if (generation !== null) {
            ensureFirstRunSeeds({ fileGeneration: info.generation, indexGeneration: generation })
              .catch((err) => {
                console.error('first-run seed failed:', errorMessage(err))
              })
              .finally(() => {
                if (seq === openSeq.current) {
                  // Background-sync the index (reconcile → subscribe → watch),
                  // bailing if a newer open supersedes this one.
                  index.sync(generation, () => seq !== openSeq.current)
                }
              })
          } else {
            // No index — tear down any live lifecycle left from the prior graph.
            void index.close()
          }
        } catch (err) {
          if (seq !== openSeq.current) {
            return false
          }
          setError(errorMessage(err))
          setStatus('choosing')
        }
        if (seq === openSeq.current) {
          await loadRecents()
        }
        return opened
      }
      // `graph_open` mutates Rust's GraphState (`set_root`), so overlapping opens
      // could otherwise have a slow older call land *after* a newer one and leave
      // the backend on a different graph than the UI. Serialize them: running
      // one-at-a-time in request order makes the last-requested open the last to
      // touch GraphState, matching the `openSeq`-pinned UI.
      const next = openChain.current.then(run, run)
      openChain.current = next
      return next
    },
    [loadRecents, platform],
  )

  // The mobile bootstrap + onboarding slice (Plans 19/21) lives in its own
  // hook; `onParked` is its channel back onto this provider's status/error.
  const onParked = useCallback((parkError: string | null): void => {
    setError(parkError)
    setStatus('choosing')
  }, [])
  const {
    needsOnboarding,
    mobileStorageInfo,
    mobileStorageResolving,
    mobileStorageKind,
    completeOnboarding,
  } = useMobileGraphBoot({ platform, openRecent, onParked })

  // Secondary note windows never open a graph: they adopt the main window's.
  useNoteWindowBoot({
    platform,
    onAdopted: useCallback((boot) => {
      setGraph(boot.graph)
      setIndexGeneration(boot.indexGeneration)
      setStatus('ready')
    }, []),
    onFailed: useCallback((message) => {
      // Off-main, 'choosing' renders as an error screen (app.tsx), never the
      // chooser — choosing here would re-root every other window.
      setError(message)
      setStatus('choosing')
    }, []),
  })

  // Desktop main-window boot: reopen the most recent graph, or show the
  // chooser. Mobile and note windows boot through their hooks above.
  useDesktopGraphBoot({
    platform,
    loadRecents,
    openRecent,
    onChoose: useCallback(() => setStatus('choosing'), []),
  })

  /**
   * Create (and open) a graph at an app-chosen path — desktop onboarding's
   * iCloud path, where the app names the folder inside the container rather
   * than showing a picker. Same serialized open flow as `openRecent`;
   * `createGraph` bootstraps the directory first (idempotent when it exists).
   */
  const createAt = useCallback(
    async (root: string): Promise<boolean> => {
      // Guarded BEFORE createGraph: graph_create activates the shared Rust
      // session, so off-main it would re-root every window even though the
      // openRecent below refuses.
      if (!requireMainWindow('creating a graph')) {
        return false
      }
      try {
        await createGraph(root)
      } catch (err) {
        setError(errorMessage(err))
        return false
      }
      return await openRecent(root)
    },
    [openRecent],
  )

  const pickAndOpen = useCallback(async (): Promise<void> => {
    let selected: string | null = null
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: 'Choose a graph folder',
        ...(await pickerDefaultPath(recents.length > 0)),
      })
      selected = typeof result === 'string' ? result : null
    } catch (err) {
      setError(errorMessage(err))
      return
    }
    if (selected) {
      const opened = await openRecent(selected)
      if (opened && latestOpenRoot.current === selected && !isICloudRoot(selected)) {
        setPendingLocalSyncOffer(true)
      }
    }
  }, [openRecent, recents])

  const dismissLocalSyncOffer = useCallback((): void => {
    setPendingLocalSyncOffer(false)
  }, [])

  const closeActiveGraph = useCallback(async (): Promise<void> => {
    ++openSeq.current
    await indexRef.current.close()
    resetNoteRowOverlays()
    setGraph(null)
    setIndexGeneration(null)
    setIndexReady(false)
    setIndexing(false)
    setError(null)
    setPendingLocalSyncOffer(false)
    setStatus('choosing')
  }, [])

  const chooseGraph = useCallback(async (): Promise<void> => {
    if (!requireMainWindow('switching graphs')) {
      return
    }
    await closeSecondaryWindows(platform) // the session they adopted is ending
    await closeActiveGraph()
    await loadRecents({ surfaceErrors: true })
  }, [closeActiveGraph, loadRecents, platform])

  const forget = useCallback(
    async (root: string): Promise<void> => {
      try {
        await forgetRecent(root)
        await loadRecents()
        if (graph?.root === root) {
          // Forgetting the ACTIVE graph ends the session its note windows
          // adopted — same close-first rule as switch/delete.
          await closeSecondaryWindows(platform)
          await closeActiveGraph()
        }
      } catch {
        // best-effort
      }
    },
    [closeActiveGraph, graph, loadRecents, platform],
  )

  const deleteGraph = useCallback(async (): Promise<void> => {
    if (!isMainWindow()) {
      throw new Error('Deleting a graph is only available from the main window.')
    }
    if (graph === null) {
      return
    }
    const { root, generation } = graph
    // A newer open while the delete is in flight supersedes it (the Rust
    // side already refuses the stale generation) — never tear down or
    // re-open the graph the user switched to.
    const seq = openSeq.current
    try {
      await closeSecondaryWindows(platform) // before the delete invalidates the session
      await deleteGraphCommand(generation)
    } catch (err) {
      // The command invalidates the Rust session before touching the
      // filesystem, so a failed trash leaves the directory intact but the
      // session pin dead — re-open the graph to restore a writable session,
      // then let the confirm dialog surface the error.
      if (seq === openSeq.current) {
        await openRecent(root)
      }
      throw err
    }
    // The delete trashed a directory the chooser may list — drop the cached
    // iCloud listing so the chooser refetches it rather than showing the
    // deleted graph (queries never go stale on their own, see query-client).
    dropIcloudStatusQuery()
    if (seq === openSeq.current) {
      await closeActiveGraph()
    }
    await loadRecents()
  }, [closeActiveGraph, graph, loadRecents, openRecent, platform])

  const refreshIndex = useCallback((): void => {
    // Off-main, a refresh would start a second concurrent index writer.
    if (indexGeneration === null || !isMainWindow()) {
      return
    }
    // The index lifecycle coalesces stacked triggers (resume + poll-end +
    // watch-failed can fire together) into a single queued rerun.
    const seq = openSeq.current
    indexRef.current.refresh(indexGeneration, () => seq !== openSeq.current)
  }, [indexGeneration])
  useReconcileRequests(bridgeReady, refreshIndex)

  const value = useMemo<GraphContextValue>(
    () => ({
      platform,
      status,
      graph,
      recents,
      indexGeneration,
      indexReady,
      indexing,
      error,
      pendingLocalSyncOffer,
      dismissLocalSyncOffer,
      pickAndOpen,
      chooseGraph,
      createAt,
      openRecent,
      forget,
      deleteGraph,
      needsOnboarding,
      mobileStorageInfo,
      mobileStorageResolving,
      mobileStorageKind,
      completeOnboarding,
      refreshIndex,
    }),
    [
      platform,
      status,
      graph,
      recents,
      indexGeneration,
      indexReady,
      indexing,
      error,
      pendingLocalSyncOffer,
      dismissLocalSyncOffer,
      pickAndOpen,
      chooseGraph,
      createAt,
      openRecent,
      forget,
      deleteGraph,
      needsOnboarding,
      mobileStorageInfo,
      mobileStorageResolving,
      mobileStorageKind,
      completeOnboarding,
      refreshIndex,
    ],
  )

  return <GraphContext value={value}>{children}</GraphContext>
}
