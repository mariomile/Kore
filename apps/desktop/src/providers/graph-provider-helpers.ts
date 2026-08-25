import { homeDir, join } from '@tauri-apps/api/path'
import { errorMessage } from '@reflect/core'

/**
 * On a macOS first run (no recents yet), start the folder picker in iCloud
 * Drive — the recommended home for a graph (Plan 21): notes back up
 * automatically and the iOS app's container lives there too. Suggestion
 * only: the user can navigate anywhere, and once they have a graph the
 * picker reverts to the OS default (their last-used location). Best-effort —
 * a resolution failure (or a signed-out account's missing folder, which the
 * open panel falls back from on its own) must never block picking.
 */
export async function pickerDefaultPath(
  hasRecents: boolean,
): Promise<{ defaultPath: string } | null> {
  if (hasRecents || import.meta.env.TAURI_ENV_PLATFORM !== 'darwin') {
    return null
  }
  try {
    const home = await homeDir()
    return { defaultPath: await join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs') }
  } catch (err) {
    console.warn('iCloud Drive picker suggestion failed:', errorMessage(err))
    return null
  }
}
