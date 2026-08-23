import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { ChevronDown } from '@/components/icons'
import { cn } from '@/lib/utils'
import { SETTINGS_SECTION_EXPAND_EVENT } from './section-scrolling'
import { settingsSectionDomId, settingsSectionTitle, type SettingsSectionId } from './sections'

/**
 * Where a section's collapsed choice is remembered between launches.
 * Best-effort, like the theme mirrors — unavailable storage just means every
 * card opens expanded.
 */
function collapseStorageKey(id: SettingsSectionId): string {
  return `reflect.settings.section-collapsed:${id}`
}

function readCollapsed(id: SettingsSectionId): boolean {
  try {
    return localStorage.getItem(collapseStorageKey(id)) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(id: SettingsSectionId, collapsed: boolean): void {
  try {
    if (collapsed) {
      localStorage.setItem(collapseStorageKey(id), '1')
    } else {
      localStorage.removeItem(collapseStorageKey(id))
    }
  } catch {
    // Storage is unavailable; the preference lives for this session only.
  }
}

interface SettingsSectionProps {
  /**
   * Which {@link SETTINGS_SECTIONS} entry this card renders. Supplies the
   * heading text and the DOM anchor the sticky navigator jumps to.
   */
  id: SettingsSectionId
  /** The card's rows, separated by hairline dividers. */
  children: ReactNode
}

/**
 * The settings page idiom (the original app's): a small section heading over
 * a bordered card whose rows are separated by hairline dividers. Every card is
 * registered in the sections registry so the navigator can list and target it.
 *
 * The heading doubles as a disclosure: clicking it folds the card away so a
 * long settings page can be tidied down to its headings. The choice sticks
 * per section (localStorage), starts expanded, and a navigator jump to a
 * collapsed card re-opens it through the expand event.
 */
export function SettingsSection({ id, children }: SettingsSectionProps): ReactElement {
  const title = settingsSectionTitle(id)
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id))

  useEffect(() => {
    const onExpandRequest = (event: Event): void => {
      if (event instanceof CustomEvent && event.detail === id) {
        setCollapsed(false)
        writeCollapsed(id, false)
      }
    }
    window.addEventListener(SETTINGS_SECTION_EXPAND_EVENT, onExpandRequest)
    return () => {
      window.removeEventListener(SETTINGS_SECTION_EXPAND_EVENT, onExpandRequest)
    }
  }, [id])

  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    writeCollapsed(id, next)
  }

  return (
    <section id={settingsSectionDomId(id)} aria-label={title} className="mt-8 first:mt-0">
      <h2 className="px-1 text-[13px] font-semibold text-text">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={toggle}
          className="group flex w-full items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <span>{title}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              'size-3.5 text-text-muted transition-transform duration-150 group-hover:text-text-secondary',
              collapsed && '-rotate-90',
            )}
          />
        </button>
      </h2>
      {collapsed ? null : (
        <div className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface shadow-sm">
          {children}
        </div>
      )}
    </section>
  )
}
