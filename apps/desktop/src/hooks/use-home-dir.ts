import { useEffect, useState } from 'react'
import { homeDir } from '@tauri-apps/api/path'

/**
 * The user's home directory, or `null` until (unless) it resolves — the prefix
 * {@link displayGraphPath} abbreviates to `~`. Resolution is best-effort: in a
 * plain browser dev session, or if the path plugin refuses, paths just show in
 * full.
 */
export function useHomeDir(): string | null {
  const [home, setHome] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const resolved = await homeDir()
        if (active) {
          setHome(resolved)
        }
      } catch {
        if (active) {
          setHome(null)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  return home
}
