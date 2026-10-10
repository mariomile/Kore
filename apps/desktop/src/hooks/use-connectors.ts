import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CONNECTORS,
  connectConnector,
  disconnectConnector,
  errorMessage,
  hasBridge,
  isConnectorConnected,
  normalizeConnectorFolder,
  type Connector,
  type ConnectorId,
  type ConnectorSettings,
} from '@reflect/core'
import type { ConnectorRunStatus } from '@/lib/connector-controller'
import { providerFetch } from '@/lib/provider-fetch'
import { useConnectorSync } from '@/providers/connector-sync-provider'
import { useSettings } from '@/providers/settings-provider'

/** One connector as the settings surfaces render it. */
export interface ConnectorView {
  readonly connector: Connector
  readonly settings: ConnectorSettings
  /** Whether a credential is stored; `null` while the keychain read is pending. */
  readonly connected: boolean | null
  readonly running: boolean
  readonly status: ConnectorRunStatus | undefined
}

export interface UseConnectorsResult {
  readonly items: readonly ConnectorView[]
  /**
   * Verify and store a credential, then turn the connector on. Without
   * `importHistory` only items from now on are imported. Throws on rejection.
   */
  connect(id: ConnectorId, token: string, importHistory: boolean): Promise<void>
  /** Forget the credential and turn the connector off. */
  disconnect(id: ConnectorId): Promise<void>
  setEnabled(id: ConnectorId, enabled: boolean): void
  /** Save the destination folder; returns an error message for an unusable one. */
  setFolder(id: ConnectorId, folder: string): string | null
  syncNow(): void
}

/**
 * Connector state and actions shared by the desktop settings section and the
 * mobile settings drawer. The credential lives in the keychain; everything
 * else is per-device settings.
 */
export function useConnectors(): UseConnectorsResult {
  const { settings, updateSettingsWith, whenSettingsLoaded } = useSettings()
  const { snapshot, syncNow } = useConnectorSync()
  const [connected, setConnected] = useState<Partial<Record<ConnectorId, boolean>>>({})
  // A sync requested together with a settings change runs once that change
  // is committed, so the loop sees the connector as enabled.
  const syncRequested = useRef(false)
  useEffect(() => {
    if (syncRequested.current) {
      syncRequested.current = false
      syncNow()
    }
  })

  useEffect(() => {
    if (!hasBridge()) {
      return // browser dev: no keychain
    }
    let cancelled = false
    void Promise.all(
      CONNECTORS.map(async (connector) => {
        // An unreadable keychain reads as "not connected": the user can
        // re-enter the credential, and a sync would fail on it anyway.
        const isConnected = await isConnectorConnected(connector.id).catch(() => false)
        return [connector.id, isConnected] as const
      }),
    ).then((entries) => {
      if (!cancelled) {
        setConnected(Object.fromEntries(entries))
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const patch = useCallback(
    (id: ConnectorId, change: Partial<ConnectorSettings>) => {
      updateSettingsWith((current) => ({
        connectors: { ...current.connectors, [id]: { ...current.connectors[id], ...change } },
      }))
    },
    [updateSettingsWith],
  )

  const connect = useCallback(
    async (id: ConnectorId, token: string, importHistory: boolean) => {
      await whenSettingsLoaded()
      await connectConnector(id, token, providerFetch)
      setConnected((current) => ({ ...current, [id]: true }))
      patch(id, {
        enabled: true,
        lastSyncedAt: null,
        importFrom: importHistory ? null : new Date().toISOString(),
      })
      syncRequested.current = true
    },
    [patch, whenSettingsLoaded],
  )

  const disconnect = useCallback(
    async (id: ConnectorId) => {
      await disconnectConnector(id)
      setConnected((current) => ({ ...current, [id]: false }))
      patch(id, { enabled: false, lastSyncedAt: null, importFrom: null })
    },
    [patch],
  )

  const setFolder = useCallback(
    (id: ConnectorId, folder: string): string | null => {
      try {
        const normalized = normalizeConnectorFolder(folder)
        const connector = CONNECTORS.find((candidate) => candidate.id === id)
        patch(id, { folder: normalized === connector?.defaultFolder ? null : normalized })
        return null
      } catch (cause) {
        return errorMessage(cause)
      }
    },
    [patch],
  )

  const items = CONNECTORS.map((connector) => ({
    connector,
    settings: settings.connectors[connector.id],
    connected: connected[connector.id] ?? null,
    running: snapshot.running === connector.id,
    status: snapshot.statuses[connector.id],
  }))

  return {
    items,
    connect,
    disconnect,
    setEnabled: (id, enabled) => patch(id, { enabled }),
    setFolder,
    syncNow,
  }
}

/** One line describing a connector's sync state. */
export function connectorStatusText(view: ConnectorView): string {
  if (view.running) {
    return 'Syncing…'
  }
  if (view.status?.kind === 'failed') {
    return view.status.message
  }
  if (view.status?.kind === 'synced') {
    const { created, updated } = view.status
    if (created === 0 && updated === 0) {
      return 'Up to date'
    }
    return [
      created > 0 ? `${created} new ${created === 1 ? 'note' : 'notes'}` : null,
      updated > 0 ? `${updated} updated` : null,
    ]
      .filter((part) => part !== null)
      .join(', ')
  }
  if (view.settings.lastSyncedAt !== null) {
    return `Last synced ${new Date(view.settings.lastSyncedAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`
  }
  return view.settings.enabled ? 'Waiting for the first sync' : 'Off'
}
