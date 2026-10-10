import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { ConnectorsSettings, GraphInfo } from '@reflect/core'
import { useMainWindowEffect } from '@/hooks/use-main-window-effect'
import {
  createConnectorController,
  type ConnectorController,
  type ConnectorSyncSnapshot,
} from '@/lib/connector-controller'
import { useSettings } from '@/providers/settings-provider'

interface ConnectorSyncContextValue {
  readonly snapshot: ConnectorSyncSnapshot
  /** Sync every enabled connector now. A no-op outside the main window. */
  readonly syncNow: () => void
}

const IDLE: ConnectorSyncSnapshot = { running: null, statuses: {} }

const ConnectorSyncContext = createContext<ConnectorSyncContextValue>({
  snapshot: IDLE,
  syncNow: () => {},
})

const noopSubscribe = (): (() => void) => () => {}

interface ConnectorSyncProviderProps {
  graph: GraphInfo
  children: ReactNode
}

/**
 * Mounts the connector sync loop (Readwise, Granola …) for the open graph,
 * in the main window only, once settings have loaded — a cursor read before
 * the load would look like a first sync and refetch everything.
 */
export function ConnectorSyncProvider({
  graph,
  children,
}: ConnectorSyncProviderProps): ReactElement {
  const { settings, updateSettingsWith, whenSettingsLoaded } = useSettings()
  const settingsRef = useRef<ConnectorsSettings>(settings.connectors)
  // A layout effect, so the ref is current before any child's passive
  // effect asks for a sync right after changing connector settings.
  useLayoutEffect(() => {
    settingsRef.current = settings.connectors
  })
  const [controller, setController] = useState<ConnectorController | null>(null)

  useMainWindowEffect(() => {
    const next = createConnectorController({
      generation: graph.generation,
      getSettings: () => settingsRef.current,
      onSynced: (id, syncedAt) => {
        updateSettingsWith((current) => ({
          connectors: {
            ...current.connectors,
            [id]: { ...current.connectors[id], lastSyncedAt: syncedAt },
          },
        }))
      },
    })
    let disposed = false
    void whenSettingsLoaded().then(() => {
      if (!disposed) {
        setController(next)
        next.start()
      }
    })
    return () => {
      disposed = true
      next.dispose()
      setController(null)
    }
  }, [graph.generation, updateSettingsWith, whenSettingsLoaded])

  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? (() => IDLE),
  )
  const syncNow = useCallback(() => controller?.syncNow(), [controller])
  const value = useMemo(() => ({ snapshot, syncNow }), [snapshot, syncNow])

  return <ConnectorSyncContext value={value}>{children}</ConnectorSyncContext>
}

/** Connector sync state and the manual trigger, for the settings surfaces. */
export function useConnectorSync(): ConnectorSyncContextValue {
  return use(ConnectorSyncContext)
}
