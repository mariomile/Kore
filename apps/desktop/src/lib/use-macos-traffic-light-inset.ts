import { useSyncExternalStore } from 'react'
import { getMacosFullscreenSnapshot, subscribeMacosFullscreen } from '@/lib/macos-fullscreen-store'
import { hasMacosTitleBarOverlay, needsMacosTrafficLightInset } from '@/lib/window-chrome'

/**
 * Live "should chrome reserve space for the traffic lights?" flag. False on
 * every non-overlay platform, and on macOS once the window is fullscreen so
 * the dedicated title-bar band can collapse.
 */
export function useMacosTrafficLightInset(): boolean {
  const isFullscreen = useSyncExternalStore(
    subscribeMacosFullscreen,
    getMacosFullscreenSnapshot,
    getMacosFullscreenSnapshot,
  )
  return needsMacosTrafficLightInset(hasMacosTitleBarOverlay, isFullscreen)
}
