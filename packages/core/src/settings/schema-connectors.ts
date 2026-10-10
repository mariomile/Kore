import { z } from 'zod'

/**
 * Per-device state of one connector (`connectors/registry`). The credential
 * is not here — it lives in the OS keychain under `connectorSecretName`.
 * `folder` is graph-relative; `null` means the connector's default folder.
 * `lastSyncedAt` is the start of the last complete run, the next run's
 * cursor; `null` means the next run is a full sync. `importFrom` is the
 * oldest item worth importing — set to the connect time when the user skips
 * history; `null` imports everything.
 */
export const connectorSettingsSchema = z.object({
  enabled: z.boolean().catch(false),
  folder: z.string().nullable().catch(null),
  lastSyncedAt: z.iso.datetime().nullable().catch(null),
  importFrom: z.iso.datetime().nullable().catch(null),
})

/** One connector's persisted settings. */
export type ConnectorSettings = z.infer<typeof connectorSettingsSchema>

const DEFAULT_CONNECTOR_SETTINGS: ConnectorSettings = {
  enabled: false,
  folder: null,
  lastSyncedAt: null,
  importFrom: null,
}

const connectorEntrySchema = connectorSettingsSchema.catch(DEFAULT_CONNECTOR_SETTINGS)

/**
 * Settings of every connector, keyed by connector id. Each entry degrades to
 * "off" on its own, so one mangled entry never disables the others.
 */
export const connectorsSchema = z
  .object({
    readwise: connectorEntrySchema,
    granola: connectorEntrySchema,
  })
  .catch({ readwise: DEFAULT_CONNECTOR_SETTINGS, granola: DEFAULT_CONNECTOR_SETTINGS })

/** Settings of every connector. */
export type ConnectorsSettings = z.infer<typeof connectorsSchema>
