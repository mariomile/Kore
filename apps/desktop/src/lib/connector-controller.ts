import {
  CONNECTORS,
  connectorSecretName,
  errorMessage,
  getSecret,
  hasBridge,
  syncConnector,
  toAppError,
  type Connector,
  type ConnectorId,
  type ConnectorSettings,
  type ConnectorsSettings,
} from '@kore/core'
import { createBackgroundReconciler } from '@/lib/background-reconciler'
import { startOperation } from '@/lib/operations'
import { providerFetch } from '@/lib/provider-fetch'

/** How often the loop wakes to see which sources are due: the shortest choice. */
const TICK_MS = 5 * 60 * 1000

/** The outcome of a connector's latest run in this session. */
export type ConnectorRunStatus =
  | { readonly kind: 'synced'; readonly created: number; readonly updated: number }
  | { readonly kind: 'failed'; readonly message: string }

/** What the settings UI shows about connector sync. */
export interface ConnectorSyncSnapshot {
  /** The connector syncing right now, if any. */
  readonly running: ConnectorId | null
  readonly statuses: Readonly<Partial<Record<ConnectorId, ConnectorRunStatus>>>
}

export interface ConnectorController {
  /** Attach the triggers (interval, focus, resume) and run the launch pass. */
  start(): void
  /** Sync one enabled connector now, ignoring its frequency. */
  syncNow(id: ConnectorId): void
  subscribe(listener: () => void): () => void
  getSnapshot(): ConnectorSyncSnapshot
  /** Tear down triggers and abort an in-flight pass at its next gate. */
  dispose(): void
}

export interface ConnectorControllerOptions {
  /** The open graph's generation — every write pins to it. */
  generation: number
  /** The latest connector settings, read at the start of every pass. */
  getSettings: () => ConnectorsSettings
  /** Persist a completed run's cursor. */
  onSynced: (id: ConnectorId, syncedAt: string) => void
}

/**
 * Whether an automatic pass should sync this source, by the user's choice:
 * every N minutes, once per launch (`launch`), or never on its own (`manual`).
 */
function isDue(entry: ConnectorSettings, now: number, sessionStart: number): boolean {
  if (entry.syncEvery === 'manual') {
    return false
  }
  if (entry.lastSyncedAt === null) {
    return true
  }
  const last = Date.parse(entry.lastSyncedAt)
  if (entry.syncEvery === 'launch') {
    return last < sessionStart
  }
  return now - last >= entry.syncEvery * 60 * 1000
}

/**
 * The connector-sync lifecycle for one graph session (Readwise, Granola …):
 * a single-flight loop over the enabled connectors on the shared
 * {@link createBackgroundReconciler}. It runs at launch, on a timer, when the
 * window regains focus or the app returns to the foreground, and on demand
 * from Settings. Credentials are read from the keychain per pass, so a key
 * saved in Settings is used by the very next run.
 */
export function createConnectorController(
  options: ConnectorControllerOptions,
): ConnectorController {
  let snapshot: ConnectorSyncSnapshot = { running: null, statuses: {} }
  const listeners = new Set<() => void>()
  /** Connectors asked for by hand, synced on the next pass whatever their frequency. */
  const forced = new Set<ConnectorId>()
  const sessionStart = Date.now()
  /** Last failure toasted per connector — retries must not re-toast it. */
  const surfaced = new Map<ConnectorId, string>()

  function publish(next: ConnectorSyncSnapshot): void {
    snapshot = next
    for (const listener of listeners) {
      listener()
    }
  }

  function record(id: ConnectorId, status: ConnectorRunStatus): void {
    publish({ running: snapshot.running, statuses: { ...snapshot.statuses, [id]: status } })
  }

  async function syncOne(
    connector: Connector,
    entry: ConnectorSettings,
    isStale: () => boolean,
  ): Promise<void> {
    const { id } = connector
    publish({ ...snapshot, running: id })
    try {
      const token = await getSecret(connectorSecretName(id))
      if (token === null || token.trim() === '') {
        record(id, {
          kind: 'failed',
          message: `Add your ${connector.label} ${connector.tokenNoun}.`,
        })
        return
      }
      const result = await syncConnector({
        connector,
        token: token.trim(),
        folder: entry.folder ?? connector.defaultFolder,
        pattern: entry.pattern,
        tags: entry.tags,
        options: entry.options,
        dailyHeading: entry.dailyLink ? (entry.dailyHeading ?? connector.dailyHeading) : null,
        since: entry.lastSyncedAt === null ? null : new Date(entry.lastSyncedAt),
        floor: entry.importFrom === null ? null : new Date(entry.importFrom),
        generation: options.generation,
        fetchFn: providerFetch,
        isStale,
      })
      if (result.syncedAt !== null) {
        options.onSynced(id, result.syncedAt)
      }
      surfaced.delete(id)
      record(id, { kind: 'synced', created: result.created, updated: result.updated })
    } catch (cause) {
      const message = errorMessage(cause)
      record(id, { kind: 'failed', message })
      // Offline retries quietly on the next trigger; anything else (a revoked
      // token, a bad folder) needs the user, once.
      if (toAppError(cause).kind !== 'network' && surfaced.get(id) !== message) {
        surfaced.set(id, message)
        startOperation(`Syncing ${connector.label}`).fail(message)
      }
    } finally {
      publish({ ...snapshot, running: null })
    }
  }

  const loop = createBackgroundReconciler({
    pass: async (isStale) => {
      if (!hasBridge()) {
        return // browser dev: no graph to write into
      }
      const force = new Set(forced)
      forced.clear()
      const settings = options.getSettings()
      const now = Date.now()
      for (const connector of CONNECTORS) {
        const entry = settings[connector.id]
        if (isStale()) {
          return
        }
        if (!entry.enabled || (!force.has(connector.id) && !isDue(entry, now, sessionStart))) {
          continue
        }
        await syncOne(connector, entry, isStale)
      }
    },
  })

  function start(): void {
    if (loop.isStale()) {
      return
    }
    loop.schedule()
    loop.retryOnWake()
    const timer = window.setInterval(loop.schedule, TICK_MS)
    // `focus` is unreliable in the iOS webview; resume arrives as visibility.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        loop.schedule()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    loop.onDispose(() => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    })
  }

  return {
    start,
    syncNow(id) {
      forced.add(id)
      loop.schedule()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    dispose: loop.dispose,
  }
}
