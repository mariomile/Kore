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
  onCapture: () => void
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
export function MobileTabBar({ tab, onSelect, onCapture }: MobileTabBarProps): ReactElement {
  const navRef = useRef<HTMLElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)

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

  useLayoutEffect(() => {
    const nav = navRef.current
    const indicator = indicatorRef.current
    if (nav === null || indicator === null) {
      return
    }

    const positionIndicator = (): void => {
      const activeButton = nav.querySelector<HTMLElement>(`[data-mobile-tab="${CSS.escape(tab)}"]`)
      if (activeButton === null) {
        return
      }
      const navBounds = nav.getBoundingClientRect()
      const buttonBounds = activeButton.getBoundingClientRect()
      indicator.style.width = `${buttonBounds.width}px`
      indicator.style.height = `${buttonBounds.height}px`
      indicator.style.transform = `translate3d(${buttonBounds.left - navBounds.left}px, ${buttonBounds.top - navBounds.top}px, 0)`
      indicator.style.opacity = '1'
    }

    positionIndicator()
    const observer = new ResizeObserver(positionIndicator)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [tab])

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
      <span
        ref={indicatorRef}
        data-testid="mobile-tab-indicator"
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 z-10 rounded-full bg-foreground/10 opacity-0 transition-[transform,width,height,opacity] duration-200 ease-swift motion-reduce:transition-none"
      />
      <div className="flex w-full max-w-md items-center justify-between gap-4">
        <div className="mobile-nav-capsule flex max-w-56 flex-1 p-1">
          <TabButton
            tab="daily"
            label="Daily"
            icon={<NoteEdit aria-hidden className="size-6" />}
            active={tab === 'daily'}
            onClick={() => onSelect('daily')}
          />
          <TabButton
            tab="all"
            label="All"
            icon={<Notes aria-hidden className="size-6" />}
            active={tab === 'all'}
            onClick={() => onSelect('all')}
          />
          <TabButton
            tab="tasks"
            label="Tasks"
            icon={<CheckCircle aria-hidden className="size-6" />}
            active={tab === 'tasks'}
            onClick={() => onSelect('tasks')}
          />
        </div>
        <div className="mobile-nav-capsule flex shrink-0 p-1">
          <TabButton
            tab="chat"
            label="Chat"
            icon={<Chat aria-hidden className="size-6" />}
            active={tab === 'chat'}
            onClick={() => onSelect('chat')}
          />
          <button
            type="button"
            aria-label="New"
            onClick={() => {
              hapticImpactLight()
              onCapture()
            }}
            className="relative z-20 flex size-12 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  tab,
  label,
  icon,
  active,
  onClick,
}: {
  tab: MobileTab
  label: string
  icon: ReactElement
  active: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      data-mobile-tab={tab}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      // V1 parity: a light haptic on every tab press, including the two taps
      // that make Daily's double-tap-to-today gesture.
      onClick={() => {
        hapticImpactLight()
        onClick()
      }}
      className={cn(
        'relative z-20 flex h-12 min-w-12 flex-1 items-center justify-center rounded-full outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        active ? 'text-foreground' : 'text-foreground/70 active:bg-foreground/5',
      )}
    >
      {icon}
    </button>
  )
}
