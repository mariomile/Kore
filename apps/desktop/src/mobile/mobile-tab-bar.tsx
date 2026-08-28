import { useLayoutEffect, useRef, type ReactElement } from 'react'
import { Chat, CheckCircle, NoteEdit, Notes, Plus } from '@/components/icons'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'
import type { Route } from '@/routing/route'

export type MobileTab = 'daily' | 'all' | 'tasks' | 'chat'

/** The tab whose root screen a route shows, or `null` for stacked screens. */
export function tabRootFor(route: Route): MobileTab | null {
  switch (route.kind) {
    case 'today':
    case 'daily':
      return 'daily'
    case 'allNotes':
    case 'search':
      return 'all'
    case 'tasks':
      return 'tasks'
    case 'chat':
      return 'chat'
    default:
      return null
  }
}

interface MobileTabBarProps {
  tab: MobileTab
  onSelect: (tab: MobileTab) => void
  onNewNote: () => void
}

/**
 * Floating navigation capsules: Daily, All and Tasks on the left, Chat and
 * new-note capture on the right. The shell hides them while typing.
 *
 * The bar publishes its measured height as `--mobile-tab-bar-height` on the
 * document root, so viewport-anchored elements (the sync status pill) can
 * sit above it without hardcoding its size. The variable clears on unmount
 * (the keyboard-up state), leaving consumers their own fallback.
 */
export function MobileTabBar({ tab, onSelect, onNewNote }: MobileTabBarProps): ReactElement {
  const navRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const nav = navRef.current
    const root = document.documentElement
    if (nav === null) {
      return
    }
    const publish = (): void => {
      root.style.setProperty('--mobile-tab-bar-height', `${nav.offsetHeight}px`)
    }
    publish()
    // Content-sized: the height moves with rotation (safe-area padding).
    const observer = new ResizeObserver(publish)
    observer.observe(nav)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--mobile-tab-bar-height')
    }
  }, [])

  return (
    <nav
      ref={navRef}
      aria-label="Sections"
      className="mobile-nav-bar pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center pt-3"
      style={{
        paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)',
        paddingLeft: 'max(env(safe-area-inset-left), 1rem)',
        paddingRight: 'max(env(safe-area-inset-right), 1rem)',
      }}
    >
      <div className="flex w-full max-w-md items-center justify-between gap-4">
        <div className="mobile-nav-capsule flex max-w-56 flex-1 p-1">
          <TabButton
            label="Daily"
            icon={<NoteEdit aria-hidden className="size-6" />}
            active={tab === 'daily'}
            onClick={() => onSelect('daily')}
          />
          <TabButton
            label="All"
            icon={<Notes aria-hidden className="size-6" />}
            active={tab === 'all'}
            onClick={() => onSelect('all')}
          />
          <TabButton
            label="Tasks"
            icon={<CheckCircle aria-hidden className="size-6" />}
            active={tab === 'tasks'}
            onClick={() => onSelect('tasks')}
          />
        </div>
        <div className="mobile-nav-capsule flex shrink-0 p-1">
          <TabButton
            label="Chat"
            icon={<Chat aria-hidden className="size-6" />}
            active={tab === 'chat'}
            onClick={() => onSelect('chat')}
          />
          <button
            type="button"
            aria-label="New note"
            onClick={() => {
              hapticImpactLight()
              onNewNote()
            }}
            className="flex size-12 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-background">
              <Plus aria-hidden className="size-6" />
            </span>
          </button>
        </div>
      </div>
    </nav>
  )
}

function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: ReactElement
  active: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      // V1 parity: a light haptic on every tab press, including the two taps
      // that make Daily's double-tap-to-today gesture.
      onClick={() => {
        hapticImpactLight()
        onClick()
      }}
      className={cn(
        'flex h-12 min-w-12 flex-1 items-center justify-center rounded-full outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        active ? 'bg-foreground/10 text-foreground' : 'text-foreground/70 active:bg-foreground/5',
      )}
    >
      {icon}
    </button>
  )
}
