import { useSyncExternalStore } from 'react'
import { getMacosFullscreenSnapshot, subscribeMacosFullscreen } from '@/lib/macos-fullscreen-store'
import { hasMacosTitleBarOverlay, needsMacosTrafficLightInset } from '@/lib/window-chrome'

/**
 * Live "should chrome clear the traffic lights?" flag. False on every
 * non-overlay platform, and on macOS once the window is fullscreen so the
 * Home/Chat/Meetings bar can use the width the lights were sitting on.
 */
export function useMacosTrafficLightInset(): boolean {
  const isFullscreen = useSyncExternalStore(
    subscribeMacosFullscreen,
    getMacosFullscreenSnapshot,
    getMacosFullscreenSnapshot,
  )
  return needsMacosTrafficLightInset(hasMacosTitleBarOverlay, isFullscreen)
}
