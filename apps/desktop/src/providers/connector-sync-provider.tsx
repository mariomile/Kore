import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { ConnectorId, ConnectorSettings, ConnectorsSettings, GraphInfo } from '@kore/core'
import { useMainWindowEffect } from '@/hooks/use-main-window-effect'
import { useVaultConnectors } from '@/hooks/use-vault-connectors'
import {
  createConnectorController,
  type ConnectorController,
  type ConnectorSyncSnapshot,
} from '@/lib/connector-controller'
import { useSettings } from '@/providers/settings-provider'

interface ConnectorSyncContextValue {
  readonly snapshot: ConnectorSyncSnapshot
  /** Sync one enabled connector now. A no-op outside the main window. */
  readonly syncNow: (id: ConnectorId) => void
  /** Each connector's effective settings (the vault's shared fields over the device's). */
  readonly connectors: ConnectorsSettings | null
  /** Change a connector's settings; each field goes where it lives (vault or device). */
  readonly updateConnector: (id: ConnectorId, change: Partial<ConnectorSettings>) => void
}

const IDLE: ConnectorSyncSnapshot = { running: null, statuses: {} }

const ConnectorSyncContext = createContext<ConnectorSyncContextValue>({
  snapshot: IDLE,
  syncNow: () => {},
  connectors: null,
  updateConnector: () => {},
})

const noopSubscribe = (): (() => void) => () => {}

interface ConnectorSyncProviderProps {
  graph: GraphInfo
  children: ReactNode
}

/**
 * Mounts the connector sync loop (Readwise, Granola …) for the open graph,
 * in the main window only, once settings and the vault's shared settings
 * have loaded: a cursor read before the load would look like a first sync
 * and refetch everything, and a folder read before the vault file would
 * land notes where this device used to put them.
 */
export function ConnectorSyncProvider({
  graph,
  children,
}: ConnectorSyncProviderProps): ReactElement {
  const { updateSettingsWith, whenSettingsLoaded } = useSettings()
  const vault = useVaultConnectors(graph.generation)
  const { refresh, whenLoaded } = vault
  const [controller, setController] = useState<ConnectorController | null>(null)

  useMainWindowEffect(() => {
    const next = createConnectorController({
      generation: graph.generation,
      // Re-read the vault file each pass: another device may have moved the
      // folder or changed the frequency since the last one.
      getSettings: refresh,
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
    void whenSettingsLoaded()
      .then(whenLoaded)
      .then(() => {
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
  }, [graph.generation, refresh, updateSettingsWith, whenLoaded, whenSettingsLoaded])

  // Coming back to the app is when another device's change is likeliest to
  // have arrived: show it in Settings without waiting for the next pass.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? (() => IDLE),
  )
  const syncNow = useCallback((id: ConnectorId) => controller?.syncNow(id), [controller])
  const value = useMemo(
    () => ({
      snapshot,
      syncNow,
      connectors: vault.connectors,
      updateConnector: vault.update,
    }),
    [snapshot, syncNow, vault.connectors, vault.update],
  )

  return <ConnectorSyncContext value={value}>{children}</ConnectorSyncContext>
}

/** Connector sync state and the manual trigger, for the settings surfaces. */
export function useConnectorSync(): ConnectorSyncContextValue {
  return use(ConnectorSyncContext)
}
