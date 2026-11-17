import { lazy, Suspense, type ReactElement, type ReactNode } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { isSettingsPage, type Route } from '@/routing/route'
import { RouterBeneath, useRouter } from '@/routing/router'
import { useCloseSettings } from '@/routing/use-close-settings'

// Reached deliberately, never on boot: the screen and its sections stay out
// of the startup chunk, as they did when Settings was a route view.
const SettingsScreen = lazy(() =>
  import('@/components/settings-screen').then((module) => ({ default: module.SettingsScreen })),
)

const LAUNCH_ROUTE: Route = { kind: 'today' }

/**
 * The workspace under the Settings modal: it keeps showing the route Settings
 * was opened from instead of following the Settings navigations.
 */
export function BeneathSettings({ children }: { children: ReactNode }): ReactElement {
  return (
    <RouterBeneath covers={isSettingsPage} fallback={LAUNCH_ROUTE}>
      {children}
    </RouterBeneath>
  )
}

/**
 * Settings on the Mac: a large centered sheet over the dimmed, blurred
 * workspace, the way macOS apps present preferences inside the window. It is
 * still a route (`settings`, one group per entry), so ⌘, deep links, Back and
 * the palette behave as before; Escape, a click outside and the Close button
 * all return to where it was opened from.
 */
export function SettingsModal(): ReactElement {
  const { route } = useRouter()
  const close = useCloseSettings()
  const open = isSettingsPage(route)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close()
        }
      }}
    >
      <DialogContent
        aria-label="Settings"
        showCloseButton={false}
        overlayClassName="bg-black/25 supports-backdrop-filter:backdrop-blur-sm dark:bg-black/50"
        className="block h-[min(740px,calc(100vh-4rem))] w-[min(1100px,calc(100vw-4rem))] max-w-none overflow-hidden rounded-2xl bg-surface-app p-0 shadow-pop ring-1 ring-border"
      >
        <Suspense fallback={null}>
          <SettingsScreen closeOnEscape={false} />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}
