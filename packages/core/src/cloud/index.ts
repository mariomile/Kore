/**
 * Kore Cloud (Plan 34): the vault always on for every agent, in the user's
 * own Cloudflare account. Everything here is host-neutral (transport and
 * notes come in as arguments), so `kore cloud setup` under Node and the app's
 * Settings run the same code. The app's own bindings (keychain, the open
 * vault) are in `./app`.
 */
export * from './activate'
export * from './client'
export * from './cloudflare'
export * from './provision'
export * from './upload'
export {
  MAX_SOURCE_BYTES,
  byteLength,
  describeNote,
  isNotePath,
  isPrivateSource,
} from './note-rules'
