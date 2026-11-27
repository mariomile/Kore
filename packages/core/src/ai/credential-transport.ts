/**
 * The rule for where an API key may travel: over https anywhere, over plain
 * http only to this machine or the local network (a model server on the Mac
 * mini in the next room). A key sent over plain http across the internet is
 * readable by every hop on the way, so the app transport refuses it outright
 * instead of warning.
 */

/** Request headers that carry a credential. */
const CREDENTIAL_HEADERS = [
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
] as const

/** Why a request carrying a key over public plain http was refused. */
export const PLAIN_HTTP_KEY_REFUSAL =
  'Kore never sends an API key over plain http outside your local network. Use an https endpoint.'

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u

function isLocalIpv4(first: number, second: number): boolean {
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  )
}

/**
 * Whether `hostname` (as `URL.hostname` spells it) names this machine or the
 * local network: loopback, the RFC 1918 and link-local IPv4 ranges, IPv6
 * loopback / unique-local / link-local, `localhost` and mDNS `.local` names.
 */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replaceAll(/^\[|\]$/gu, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true
  }
  const ipv4 = IPV4.exec(host)
  if (ipv4) {
    return isLocalIpv4(Number(ipv4[1]), Number(ipv4[2]))
  }
  if (host.includes(':')) {
    return host === '::1' || /^f[cd][0-9a-f]{0,2}:/u.test(host) || /^fe[89ab][0-9a-f]?:/u.test(host)
  }
  return false
}

/** Whether `url` is plain http to a host beyond the local network. */
export function isPlainHttpPublicUrl(url: string | URL): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && !isLocalNetworkHost(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * The refusal for a request to `url` with these headers, or `null` when it
 * may go out: a credential header over public plain http is refused.
 */
export function credentialTransportRefusal(
  url: string | URL,
  ...headerSets: readonly Headers[]
): string | null {
  if (!isPlainHttpPublicUrl(url)) {
    return null
  }
  const carriesCredential = headerSets.some((headers) =>
    CREDENTIAL_HEADERS.some((name) => (headers.get(name) ?? '').trim() !== ''),
  )
  return carriesCredential ? PLAIN_HTTP_KEY_REFUSAL : null
}
