import type { ConnectorSettings } from '../settings/schema'
import type { SyncConnectorInput } from './sync'
import type { Connector } from './types'

/**
 * How one connector's persisted settings become a sync: whether an automatic
 * pass should run it now, and the inputs that run uses. Every host (the app
 * loop today) reads the same policy from here.
 */

/**
 * Whether an automatic pass should sync this source, by the user's choice:
 * every N minutes, once per launch (`launch`), or never on its own
 * (`manual`). `sessionStart` is when this app session began.
 */
export function isConnectorSyncDue(
  entry: ConnectorSettings,
  now: number,
  sessionStart: number,
): boolean {
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

/** The parts of a sync that come from the user's settings for `connector`. */
export type ConnectorRunSettings = Pick<
  SyncConnectorInput,
  'folder' | 'pattern' | 'tags' | 'options' | 'dailyHeading' | 'since' | 'floor'
>

/** Resolve `entry` against the connector's defaults into sync inputs. */
export function connectorRunSettings(
  connector: Connector,
  entry: ConnectorSettings,
): ConnectorRunSettings {
  return {
    folder: entry.folder ?? connector.defaultFolder,
    pattern: entry.pattern,
    tags: entry.tags,
    options: entry.options,
    dailyHeading: entry.dailyLink ? (entry.dailyHeading ?? connector.dailyHeading) : null,
    since: entry.lastSyncedAt === null ? null : new Date(entry.lastSyncedAt),
    floor: entry.importFrom === null ? null : new Date(entry.importFrom),
  }
}
