import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  adoptDeviceConnectors,
  errorMessage,
  mergeVaultConnectors,
  readVaultSettings,
  splitConnectorChange,
  withVaultConnector,
  writeVaultSettings,
  type ConnectorId,
  type ConnectorSettings,
  type ConnectorsSettings,
  type VaultSettings,
} from '@kore/core'
import { startOperation } from '@/lib/operations'
import { useSettings } from '@/providers/settings-provider'

export interface VaultConnectors {
  /** Each connector's effective settings: the device's, the vault's shared fields over them. */
  readonly connectors: ConnectorsSettings
  /** Resolves once the vault file has been read and, the first time, adopted. */
  whenLoaded(): Promise<void>
  /** Re-read the vault file (another device may have changed it) and return the result. */
  refresh(): Promise<ConnectorsSettings>
  /** Apply a change: shared fields go to the vault file, the rest to this device. */
  update(id: ConnectorId, change: Partial<ConnectorSettings>): void
}

/**
 * Connector settings split between the vault and the device
 * (`connectors/vault-settings`): where and how notes land, how often they
 * sync and the daily link are in the vault's `.kore.json`, shared by every
 * device that opens it; whether this device syncs and its sync window stay
 * in its own settings. A vault without the file adopts this device's
 * choices on first open.
 */
export function useVaultConnectors(generation: number): VaultConnectors {
  const { settings, updateSettingsWith, whenSettingsLoaded } = useSettings()
  // Keyed by graph, so a graph switch reads as "not loaded" without a reset.
  const [stored, setStored] = useState<{ generation: number; vault: VaultSettings } | null>(null)
  const vault = stored?.generation === generation ? stored.vault : null
  const setVault = useCallback(
    (next: VaultSettings) => setStored({ generation, vault: next }),
    [generation],
  )
  // Current before any passive effect (the load below) reads it.
  const deviceRef = useRef(settings.connectors)
  useLayoutEffect(() => {
    deviceRef.current = settings.connectors
  })
  const loaded = useRef<Promise<void>>(Promise.resolve())
  // Writes queue up, so two quick edits land in the order they were made.
  const writes = useRef<Promise<void>>(Promise.resolve())
  const lastWrite = useRef(0)

  useEffect(() => {
    let cancelled = false
    loaded.current = (async () => {
      await whenSettingsLoaded()
      let read: VaultSettings
      try {
        read = await readVaultSettings(generation)
      } catch (cause) {
        // Unreadable (not merely absent): run on this device's settings and
        // leave the file alone rather than overwrite what we could not read.
        if (!cancelled) {
          startOperation('Reading integration settings').fail(errorMessage(cause))
          setVault({})
        }
        return
      }
      if (cancelled) {
        return
      }
      const adopted = adoptDeviceConnectors(deviceRef.current, read)
      setVault(adopted ?? read)
      if (adopted !== null) {
        await writeVaultSettings(adopted, generation).catch((cause: unknown) => {
          startOperation('Saving integration settings').fail(errorMessage(cause))
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [generation, setVault, whenSettingsLoaded])

  const refresh = useCallback(async (): Promise<ConnectorsSettings> => {
    await loaded.current
    // A queued write would be undone by reading the file before it lands.
    await writes.current
    try {
      const read = await readVaultSettings(generation)
      setVault(read)
      return mergeVaultConnectors(deviceRef.current, read)
    } catch {
      // Keep what we have; the next refresh tries again.
      return deviceRef.current
    }
  }, [generation, setVault])

  const update = useCallback(
    (id: ConnectorId, change: Partial<ConnectorSettings>) => {
      const { shared, device } = splitConnectorChange(change)
      if (Object.keys(device).length > 0) {
        updateSettingsWith((current) => ({
          connectors: { ...current.connectors, [id]: { ...current.connectors[id], ...device } },
        }))
      }
      if (Object.keys(shared).length === 0) {
        return
      }
      setStored((current) => ({
        generation,
        vault: withVaultConnector(
          current?.generation === generation ? current.vault : {},
          id,
          shared,
        ),
      }))
      const ticket = ++lastWrite.current
      writes.current = writes.current
        // After the first read, which would otherwise undo this edit on screen.
        .then(() => loaded.current)
        .then(async () => {
          // Read-modify-write against the file itself, so a change another
          // device made to a different field or source survives this one.
          const next = withVaultConnector(await readVaultSettings(generation), id, shared)
          await writeVaultSettings(next, generation)
          // Only the last queued edit settles the screen; an earlier one would
          // briefly undo the edits still behind it.
          if (ticket === lastWrite.current) {
            setVault(next)
          }
        })
        .catch((cause: unknown) => {
          startOperation('Saving integration settings').fail(errorMessage(cause))
        })
    },
    [generation, setVault, updateSettingsWith],
  )

  const connectors = useMemo(
    () => (vault === null ? settings.connectors : mergeVaultConnectors(settings.connectors, vault)),
    [settings.connectors, vault],
  )
  const whenLoaded = useCallback(() => loaded.current, [])

  return useMemo(
    () => ({ connectors, whenLoaded, refresh, update }),
    [connectors, whenLoaded, refresh, update],
  )
}
