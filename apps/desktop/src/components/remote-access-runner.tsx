import { useEffect } from 'react'
import { errorMessage, startRemoteAccess, stopRemoteAccess } from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { isMacosDesktop } from '@/lib/platform'
import {
  enqueueRemoteAccess,
  remoteAccessPhase,
  setRemoteAccessPhase,
  useRemoteAccess,
} from '@/lib/remote-access-store'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

/**
 * Keeps remote access in step with its setting: while it is on, the app runs
 * `kore mcp --http` for the open graph (restarted on a graph switch, a
 * read-only change or a new token) and publishes it with Tailscale Funnel;
 * turning it off unpublishes and stops it. Quitting the app stops the server
 * natively. macOS desktop only.
 */
export function RemoteAccessRunner(): null {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const { restarts } = useRemoteAccess()
  const bridgeReady = useBridgeReady()
  const enabled = isMacosDesktop && bridgeReady && settings.remoteAccessEnabled && graph !== null
  const readOnly = settings.remoteAccessReadOnly
  const generation = graph?.generation ?? null

  useEffect(() => {
    if (!isMacosDesktop || !bridgeReady) {
      return
    }
    let current = true
    if (!enabled || generation === null) {
      if (remoteAccessPhase().kind !== 'off') {
        enqueueRemoteAccess(async () => {
          await stopRemoteAccess().catch(() => {})
          setRemoteAccessPhase({ kind: 'off' })
        })
      }
      return
    }
    setRemoteAccessPhase({ kind: 'starting' })
    enqueueRemoteAccess(async () => {
      if (!current) {
        return
      }
      try {
        const state = await startRemoteAccess({ generation, readOnly })
        if (current) {
          setRemoteAccessPhase({ kind: 'on', state })
        }
      } catch (caught) {
        if (current) {
          setRemoteAccessPhase({ kind: 'error', message: errorMessage(caught) })
        }
      }
    })
    return () => {
      current = false
    }
  }, [bridgeReady, enabled, generation, readOnly, restarts])

  return null
}
