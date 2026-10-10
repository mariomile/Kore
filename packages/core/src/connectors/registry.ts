import { granolaConnector } from './granola'
import { readwiseConnector } from './readwise'
import type { Connector, ConnectorId } from './types'

export type { Connector, ConnectorId }

/**
 * The connector library, in display order. A new source is one more
 * {@link Connector} here plus its id in {@link ConnectorId} and the settings
 * schema; sync, scheduling and the settings UI pick it up from this list.
 */
export const CONNECTORS: readonly Connector[] = [readwiseConnector, granolaConnector]

/** Look up a connector by id. */
export function connectorById(id: ConnectorId): Connector {
  const connector = CONNECTORS.find((candidate) => candidate.id === id)
  if (connector === undefined) {
    throw new Error(`unknown connector: ${id}`)
  }
  return connector
}

/** Keychain entry holding a connector's credential. */
export function connectorSecretName(id: ConnectorId): string {
  return `connector:${id}`
}
