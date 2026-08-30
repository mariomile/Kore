/**
 * The `hapticFeedback` setting, as the two haptic entry points see it:
 * desktop's trackpad knocks (`@/lib/haptics`) and iOS's light impacts
 * (`@/mobile/haptics`).
 *
 * A module-level latch rather than context, because haptics fire from call
 * sites with no React scope — a delegated `mousedown` listener, the
 * operations toaster — and gating them one by one would leave the next call
 * site to remember. `HapticFeedbackEffect` mirrors the setting into this slot
 * on every change, the same session-owned shape as the settings flusher.
 */

let enabled = true

/** Publish the current preference (called by `HapticFeedbackEffect`). */
export function setHapticsEnabled(next: boolean): void {
  enabled = next
}

/**
 * Whether haptics may fire. On until the settings document hydrates, matching
 * the setting's own default — the alternative is a silent first tap.
 */
export function hapticsEnabled(): boolean {
  return enabled
}
