import { z } from 'zod'
import { KoreError, toAppError } from '../errors'
import { call } from '../ipc/invoke'
import {
  connectorSettingsSchema,
  connectorSyncEverySchema,
  type ConnectorSettings,
  type ConnectorsSettings,
} from '../settings/schema-connectors'
import { CONNECTORS } from './registry'
import type { ConnectorId } from './types'

/**
 * The integration settings the whole vault shares, so the Mac and the iPhone
 * agree on them.
 *
 * Where notes land, how they're named and tagged, what they hold, how often
 * they sync and whether the daily note links them are choices about the
 * vault, so they live in it: `.kore.json` at the vault root, which travels
 * with GitHub sync and iCloud (the `.kore/` directory is local to each
 * machine and never does). Each device keeps only what is its own: whether
 * it syncs a source at all (its credential is in its keychain), and its
 * sync window (`lastSyncedAt`, `importFrom`).
 *
 * The file is plain JSON an agent can read and edit. Unknown keys are kept
 * on every write, and a malformed field falls back to the device's value on
 * its own, so a hand edit never breaks the other sources.
 */

/** The fields of a connector's settings that live in the vault. */
export const SHARED_CONNECTOR_KEYS = [
  'folder',
  'pattern',
  'tags',
  'syncEvery',
  'dailyLink',
  'dailyHeading',
  'options',
] as const satisfies readonly (keyof ConnectorSettings)[]

type SharedKey = (typeof SHARED_CONNECTOR_KEYS)[number]

/** One connector's vault-wide settings. */
export type SharedConnectorSettings = Pick<ConnectorSettings, SharedKey>

/** Each field optional and dropped when malformed, so the device fills it in. */
const sharedConnectorSchema = z.looseObject({
  folder: z.string().nullable().optional().catch(undefined),
  pattern: z.string().nullable().optional().catch(undefined),
  tags: z.array(z.string()).nullable().optional().catch(undefined),
  syncEvery: connectorSyncEverySchema.optional().catch(undefined),
  dailyLink: z.boolean().optional().catch(undefined),
  dailyHeading: z.string().nullable().optional().catch(undefined),
  options: z.record(z.string(), z.boolean()).optional().catch(undefined),
})

type StoredConnector = z.infer<typeof sharedConnectorSchema>

const vaultSettingsSchema = z.looseObject({
  integrations: z.record(z.string(), z.unknown()).optional().catch(undefined),
})

/** The vault settings file as read: whatever it holds, integrations parsed on use. */
export type VaultSettings = z.infer<typeof vaultSettingsSchema>

/** The vault-root file name, for messages and agent docs. */
export const VAULT_SETTINGS_FILE = '.kore.json'

/** Parse the file's text; a missing or unreadable file is an empty one. */
export function parseVaultSettings(text: string | null): VaultSettings {
  if (text === null) {
    return {}
  }
  try {
    return vaultSettingsSchema.catch({}).parse(JSON.parse(text))
  } catch {
    return {}
  }
}

/** The file's text: stable, indented JSON with a trailing newline. */
export function serializeVaultSettings(settings: VaultSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`
}

function storedConnector(vault: VaultSettings, id: ConnectorId): StoredConnector | null {
  const raw = vault.integrations?.[id]
  if (raw === undefined) {
    return null
  }
  const parsed = sharedConnectorSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** The vault-wide part of a connector's settings. */
export function sharedConnectorSettings(entry: ConnectorSettings): SharedConnectorSettings {
  return {
    folder: entry.folder,
    pattern: entry.pattern,
    tags: entry.tags,
    syncEvery: entry.syncEvery,
    dailyLink: entry.dailyLink,
    dailyHeading: entry.dailyHeading,
    options: entry.options,
  }
}

/** Split a change into what goes to the vault and what stays on the device. */
export function splitConnectorChange(change: Partial<ConnectorSettings>): {
  shared: Partial<SharedConnectorSettings>
  device: Partial<ConnectorSettings>
} {
  const shared: Partial<Record<SharedKey, unknown>> = {}
  const device: Partial<Record<keyof ConnectorSettings, unknown>> = {}
  for (const [key, value] of Object.entries(change) as [keyof ConnectorSettings, unknown][]) {
    if ((SHARED_CONNECTOR_KEYS as readonly string[]).includes(key)) {
      shared[key as SharedKey] = value
    } else {
      device[key] = value
    }
  }
  return {
    shared: shared as Partial<SharedConnectorSettings>,
    device: device as Partial<ConnectorSettings>,
  }
}

/**
 * Every connector's effective settings: the vault's fields over the
 * device's, field by field, so a field the file lacks (or holds malformed)
 * keeps the device's value.
 */
export function mergeVaultConnectors(
  device: ConnectorsSettings,
  vault: VaultSettings,
): ConnectorsSettings {
  const merged = { ...device }
  for (const { id } of CONNECTORS) {
    const stored = storedConnector(vault, id)
    if (stored === null) {
      continue
    }
    const entry = { ...device[id] }
    for (const key of SHARED_CONNECTOR_KEYS) {
      if (stored[key] !== undefined) {
        Object.assign(entry, { [key]: stored[key] })
      }
    }
    merged[id] = entry
  }
  return merged
}

/** `vault` with `change` applied to one connector, every other key kept. */
export function withVaultConnector(
  vault: VaultSettings,
  id: ConnectorId,
  change: Partial<SharedConnectorSettings>,
): VaultSettings {
  const integrations = vault.integrations ?? {}
  const current = integrations[id]
  const base = typeof current === 'object' && current !== null ? current : {}
  return { ...vault, integrations: { ...integrations, [id]: { ...base, ...change } } }
}

const DEFAULT_SHARED = sharedConnectorSettings(connectorSettingsSchema.parse({}))

/**
 * A vault that has never held integration settings adopts this device's,
 * so the first device to update keeps its choices and the others pick them
 * up. Only connectors the file lacks and the device has changed from the
 * defaults; `null` when there is nothing to write.
 */
export function adoptDeviceConnectors(
  device: ConnectorsSettings,
  vault: VaultSettings,
): VaultSettings | null {
  let next = vault
  for (const { id } of CONNECTORS) {
    if (vault.integrations?.[id] !== undefined) {
      continue
    }
    const shared = sharedConnectorSettings(device[id])
    if (JSON.stringify(shared) !== JSON.stringify(DEFAULT_SHARED)) {
      next = withVaultConnector(next, id, shared)
    }
  }
  return next === vault ? null : next
}

/**
 * Read the vault settings file; a vault without one reads as empty. A file
 * that is there but is not a JSON object (a merge conflict, a truncated
 * write, a bad hand edit) throws a `parse` error rather than reading as
 * empty, so nothing writes over what it could not read.
 */
export async function readVaultSettings(generation: number): Promise<VaultSettings> {
  let text: string
  try {
    text = await call('vault_settings_read', { generation }, z.string())
  } catch (cause) {
    if (toAppError(cause).kind === 'notFound') {
      return {}
    }
    throw cause
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    raw = null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new KoreError('parse', `${VAULT_SETTINGS_FILE} is not valid JSON; fix or delete it`)
  }
  return vaultSettingsSchema.parse(raw)
}

/** Write the vault settings file (atomically, at a path Rust fixes). */
export async function writeVaultSettings(
  settings: VaultSettings,
  generation: number,
): Promise<void> {
  await call(
    'vault_settings_write',
    { contents: serializeVaultSettings(settings), generation },
    z.null(),
  )
}
