import { useContactsAuthorization } from '@/hooks/use-contacts-authorization'
import { isMacosDesktop } from '@/lib/platform'
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsGroup } from './sections'

/** One registered settings section (see {@link SETTINGS_SECTIONS}). */
export type SettingsSectionEntry = (typeof SETTINGS_SECTIONS)[number]

/** A settings group narrowed to the sections this platform shows. */
export interface VisibleSettingsGroup {
  id: SettingsGroup['id']
  title: string
  sections: readonly SettingsSectionEntry[]
}

function sectionIsVisible(id: SettingsSectionEntry['id'], hasAppleIntegrations: boolean): boolean {
  if (id === 'integrations') {
    return hasAppleIntegrations
  }
  if (id === 'agents') {
    return isMacosDesktop
  }
  return true
}

function useHasAppleIntegrations(): boolean {
  const authorization = useContactsAuthorization()
  return isMacosDesktop || (authorization !== null && authorization !== 'unavailable')
}

/**
 * The settings sections this platform actually shows, flat and in page
 * order. Integrations only exists where the OS frameworks do (macOS/iOS —
 * the Rust shell answers `unavailable` elsewhere). Agents is macOS-only. The
 * navigator must agree with the page, so both filter through here rather
 * than reading the registry directly.
 */
export function useVisibleSettingsSections(): readonly SettingsSectionEntry[] {
  const hasAppleIntegrations = useHasAppleIntegrations()
  return SETTINGS_SECTIONS.filter((section) => sectionIsVisible(section.id, hasAppleIntegrations))
}

/** The same visibility rule, grouped — what the navigator renders. */
export function useVisibleSettingsGroups(): readonly VisibleSettingsGroup[] {
  const hasAppleIntegrations = useHasAppleIntegrations()
  return SETTINGS_GROUPS.map((group) => {
    const sections: readonly SettingsSectionEntry[] = group.sections
    return {
      id: group.id,
      title: group.title,
      sections: sections.filter((section) => sectionIsVisible(section.id, hasAppleIntegrations)),
    }
  }).filter((group) => group.sections.length > 0)
}
