import { useEffect, type ReactElement } from 'react'
import { setHapticsEnabled } from '@/lib/haptics-preference'
import { useSettings } from '@/providers/settings-provider'

/**
 * Applies the haptic-feedback preference to both haptic surfaces.
 *
 * Mirrors the `hapticFeedback` setting into the module latch that desktop's
 * trackpad knocks and iOS's light impacts both consult, so one switch covers
 * every call site — including the ones outside React (the task-checkbox
 * document listener, the operations toaster). Mounted above the platform
 * gate, since both trees fire haptics. Side-effect-only; it renders nothing.
 */
export function HapticFeedbackEffect(): ReactElement | null {
  const { settings } = useSettings()
  const hapticFeedback = settings.hapticFeedback

  useEffect(() => {
    setHapticsEnabled(hapticFeedback)
  }, [hapticFeedback])

  return null
}
