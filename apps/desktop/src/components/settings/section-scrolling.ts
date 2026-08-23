import { settingsSectionDomId, type SettingsSectionId } from './sections'

/**
 * Window event asking one settings section card to expand, carrying the
 * section id as its detail. Dispatched before a navigator jump so a
 * collapsed target opens as the page scrolls to it; each card listens for
 * its own id.
 */
export const SETTINGS_SECTION_EXPAND_EVENT = 'reflect:settings-section-expand'

/** Ask the section card with this id to expand (a no-op when already open). */
export function requestSettingsSectionExpand(id: SettingsSectionId): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_SECTION_EXPAND_EVENT, { detail: id }))
}

/**
 * Breathing room (px) left above a section's heading when jumping to it —
 * matches the settings page's `py-8` so a jumped-to heading sits exactly
 * where the page's own top padding would put it.
 */
export const SECTION_JUMP_OFFSET_PX = 32

/**
 * The nearest ancestor that actually scrolls. Used instead of
 * `Element.scrollIntoView`, which walks the whole ancestor chain and can
 * permanently nudge `overflow: hidden` boxes like the workspace frame —
 * scrolling the one container that owns the settings overflow keeps the rest
 * of the layout pinned.
 */
export function findScrollContainer(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent)
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return parent
    }
  }
  return null
}

/**
 * Scrolls the settings page so the given section's heading lands just below
 * the container's top edge. `anchor` is any element inside the settings
 * scroll container (the navigator passes its own node). Smooth unless the OS
 * asks for reduced motion.
 */
export function scrollToSettingsSection(anchor: HTMLElement, id: SettingsSectionId): void {
  const target = document.getElementById(settingsSectionDomId(id))
  const container = findScrollContainer(anchor)
  if (!target || !container) {
    return
  }
  // A collapsed card should open when jumped to. Expanding only adds height
  // below the target's heading, so the offset measured now stays valid.
  requestSettingsSectionExpand(id)
  const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
  container.scrollTo({
    top: Math.max(0, container.scrollTop + offset - SECTION_JUMP_OFFSET_PX),
    behavior,
  })
}
