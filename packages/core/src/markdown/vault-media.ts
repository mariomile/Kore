/**
 * Which vault files play inline in a note: a video or audio file that the
 * app's webview (WebKit on Mac and iPhone) can play itself. Anything else,
 * an `.mkv` say, stays a file pill that opens in the system's own player.
 */
export type VaultMediaKind = 'video' | 'audio'

const VIDEO = /\.(?:mp4|m4v|mov|webm)$/i
const AUDIO = /\.(?:mp3|m4a|aac|wav|flac)$/i

/** The inline player a vault file gets, or null when it gets none. */
export function vaultMediaKind(path: string): VaultMediaKind | null {
  const file = (path.split(/[?#]/)[0] ?? path).trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(file)) {
    // Only the vault's own files: a remote URL is a link, and links never
    // load anything until asked.
    return null
  }
  if (VIDEO.test(file)) {
    return 'video'
  }
  return AUDIO.test(file) ? 'audio' : null
}
