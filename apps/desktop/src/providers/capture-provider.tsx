import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import {
  captureHostRegister,
  captureSharedInboxRelay,
  publishShareTargets,
  type AiProvidersState,
  type GraphInfo,
} from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { useMainWindowEffect } from '@/hooks/use-main-window-effect'
import { createCaptureController } from '@/lib/capture-controller'
import { isMobileSurface } from '@/lib/platform-surface'
import { useSettings } from '@/providers/settings-provider'

/**
 * Mounts the link-capture lifecycle for the open graph (Plan 11): registers
 * the native-messaging host (pointer file + browser manifests, rewritten on
 * every graph open so app moves self-heal) and runs the
 * {@link createCaptureController} drain/enrich loop. No UI — capture has no
 * in-app surface; the capture front end is the Chrome extension on desktop
 * and the share extension on iOS, and the daily note is the output.
 *
 * On the mobile surface there is no native-messaging host to register;
 * instead every pass first relays the App Group inbox the iOS share
 * extension spools into, and the controller re-runs on app resume.
 */

// The open graph's drain trigger, so an in-app producer (the iPhone quick
// capture sheet) can drain its own envelope at once: the mobile shell has no
// file watcher, so without this a spooled line waits for the next resume.
let scheduleDrain: (() => void) | null = null

/** Ask the capture drain for a pass now; a no-op before a graph opens. */
export function requestCaptureDrain(): void {
  scheduleDrain?.()
}

/** Off the launch path: the first snapshot waits until the app has settled. */
const SHARE_TARGETS_FIRST_DELAY_MS = 8_000

/**
 * Keep the iOS share sheet's note list fresh: publish once the app settles,
 * then every time it goes to the background, which is the moment the user
 * leaves Kore for the app they will share from. Returns the teardown.
 */
function followShareTargets(): () => void {
  const publish = (): void => {
    publishShareTargets().catch((cause: unknown) => {
      console.error('share targets publish failed:', cause)
    })
  }
  const first = setTimeout(publish, SHARE_TARGETS_FIRST_DELAY_MS)
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') publish()
  }
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    clearTimeout(first)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

interface CaptureProviderProps {
  graph: GraphInfo
  children: ReactNode
}

export function CaptureProvider({ graph, children }: CaptureProviderProps): ReactElement {
  const { settings } = useSettings()

  // Read lazily at the start of every pass — a key added in Settings
  // mid-session must be seen without rebuilding the controller.
  const providersRef = useRef<AiProvidersState>({
    providers: settings.aiProviders,
    defaultProviderId: settings.defaultAiProviderId,
  })
  useEffect(() => {
    providersRef.current = {
      providers: settings.aiProviders,
      defaultProviderId: settings.defaultAiProviderId,
    }
  })

  // One drain per app: a secondary note window running its own would race
  // the main window's over the same spooled envelopes.
  const bridgeReady = useBridgeReady()
  useMainWindowEffect(() => {
    const mobile = isMobileSurface()
    const controller = createCaptureController({
      generation: graph.generation,
      getProviders: () => providersRef.current,
      ...(mobile ? { relaySharedInbox: () => captureSharedInboxRelay(graph.generation) } : {}),
    })
    // Registration (the pointer-file rewrite) completes BEFORE the first
    // drain: on a graph switch this repoints the host at the new graph as
    // early as possible, instead of draining here while the pointer still
    // names the old one. (The host reads the pointer per capture in its own
    // process, so a capture racing the rewrite can still spool to the
    // previous graph's inbox — it drains when that graph next opens.)
    // Best-effort: a failed registration must not block the drain — captures
    // already spooled must land regardless, and the extension surfaces
    // "host not found" with install guidance on its side. Mobile has no host
    // process at all: the share extension finds the App Group inbox itself.
    const registered =
      bridgeReady && !mobile
        ? captureHostRegister().catch((cause: unknown) => {
            console.error('capture host registration failed:', cause)
          })
        : Promise.resolve()
    void registered.then(() => {
      controller.start() // a no-op if the effect tore down while registering
    })
    scheduleDrain = controller.schedule
    const stopShareTargets = mobile && bridgeReady ? followShareTargets() : null
    return () => {
      if (scheduleDrain === controller.schedule) scheduleDrain = null
      stopShareTargets?.()
      controller.dispose()
    }
  }, [bridgeReady, graph.generation])

  return <>{children}</>
}
