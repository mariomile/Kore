/**
 * Scrub credentials out of text that is about to be shown or stored, chiefly
 * provider error messages: some providers echo the (partly masked) key back
 * ("Incorrect API key provided: sk-proj-****abcd"), and chat history keeps
 * every error notice for good.
 */

/** What a scrubbed credential reads as. */
export const REDACTED = '[redacted]'

/** Known exact secrets shorter than this are not scrubbed (too generic). */
const MIN_KNOWN_SECRET_LENGTH = 8

const KEY_PATTERNS: readonly RegExp[] = [
  // OpenAI, Anthropic (sk-ant-), OpenRouter (sk-or-), masked echoes included.
  /\bsk-[\w*-]{6,}/gu,
  // Google API keys.
  /\bAIza[\w-]{20,}/gu,
]

const AUTH_SCHEME = /\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/giu

/**
 * `text` with every key-shaped token, every `Bearer`/`Basic` credential, and
 * each of `knownSecrets` replaced by {@link REDACTED}.
 */
export function redactSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let redacted = text
  for (const secret of knownSecrets) {
    const trimmed = secret.trim()
    if (trimmed.length >= MIN_KNOWN_SECRET_LENGTH) {
      redacted = redacted.split(trimmed).join(REDACTED)
    }
  }
  for (const pattern of KEY_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED)
  }
  return redacted.replaceAll(AUTH_SCHEME, `$1 ${REDACTED}`)
}
