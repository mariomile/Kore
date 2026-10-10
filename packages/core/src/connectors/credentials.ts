import { deleteSecret, getSecret, setSecret } from '../secrets/keychain'
import type { FetchFn } from '../sync/github-api'
import { connectorById, connectorSecretName } from './registry'
import type { ConnectorId } from './types'

/**
 * Verify `token` against the source, then store it in the OS keychain.
 * Throws (`auth` for a rejected token) without storing anything.
 */
export async function connectConnector(
  id: ConnectorId,
  token: string,
  fetchFn: FetchFn,
): Promise<void> {
  const trimmed = token.trim()
  await connectorById(id).verify(trimmed, fetchFn)
  await setSecret(connectorSecretName(id), trimmed)
}

/** Forget a connector's credential. */
export async function disconnectConnector(id: ConnectorId): Promise<void> {
  await deleteSecret(connectorSecretName(id))
}

/** Whether a credential is stored for the connector. */
export async function isConnectorConnected(id: ConnectorId): Promise<boolean> {
  const token = await getSecret(connectorSecretName(id))
  return token !== null && token.trim() !== ''
}
