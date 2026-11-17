import { z } from 'zod'

/**
 * Per-device state of one connector (`connectors/registry`). The credential
 * is not here — it lives in the OS keychain under `connectorSecretName`.
 * `folder` is graph-relative; `null` means the connector's default folder.
 * `lastSyncedAt` is the start of the last complete run, the next run's
 * cursor; `null` means the next run is a full sync. `importFrom` is the
 * oldest item worth importing — set to the connect time when the user skips
 * history; `null` imports everything. `pattern` is where a note lands
 * inside the folder (`connectors/pattern`) and `tags` what new notes carry;
 * `null` for either means the connector's default. `syncEvery` is when
 * automatic runs happen: every N minutes, only at launch, or only on demand.
 * `dailyLink` adds a link to each new note in that day's daily note, under
 * `dailyHeading` (`null`: the connector's default). `options` holds the
 * connector's content switches (`connectors/types` `ConnectorOption`).
 */
/** Every frequency choice, in the order the settings pickers list them. */
export const CONNECTOR_SYNC_EVERY = [5, 15, 30, 60, 'launch', 'manual'] as const

export const connectorSyncEverySchema = z.literal(CONNECTOR_SYNC_EVERY)

/** When a connector syncs on its own. */
export type ConnectorSyncEvery = z.infer<typeof connectorSyncEverySchema>

export const connectorSettingsSchema = z.object({
  enabled: z.boolean().catch(false),
  folder: z.string().nullable().catch(null),
  lastSyncedAt: z.iso.datetime().nullable().catch(null),
  importFrom: z.iso.datetime().nullable().catch(null),
  pattern: z.string().nullable().catch(null),
  tags: z.array(z.string()).nullable().catch(null),
  syncEvery: connectorSyncEverySchema.catch(15),
  dailyLink: z.boolean().catch(false),
  dailyHeading: z.string().nullable().catch(null),
  options: z.record(z.string(), z.boolean()).catch({}),
})

/** One connector's persisted settings. */
export type ConnectorSettings = z.infer<typeof connectorSettingsSchema>

const DEFAULT_CONNECTOR_SETTINGS: ConnectorSettings = {
  enabled: false,
  folder: null,
  lastSyncedAt: null,
  importFrom: null,
  pattern: null,
  tags: null,
  syncEvery: 15,
  dailyLink: false,
  dailyHeading: null,
  options: {},
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
