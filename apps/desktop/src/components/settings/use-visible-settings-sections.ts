import { getVaultLayout } from '@kore/core'
import { useContactsAuthorization } from '@/hooks/use-contacts-authorization'
import { useShowAdvancedSurfaces } from '@/hooks/use-show-advanced-surfaces'
import { isMacosDesktop } from '@/lib/platform'
import { SETTINGS_GROUPS, type SettingsGroup, type SettingsSectionEntry } from './sections'

/** A settings group narrowed to the sections this platform shows. */
export interface VisibleSettingsGroup {
  id: SettingsGroup['id']
  title: string
  sections: readonly SettingsSectionEntry[]
}

function sectionIsVisible(
  id: SettingsSectionEntry['id'],
  hasAppleIntegrations: boolean,
  showAdvanced: boolean,
): boolean {
  if (id === 'integrations') {
    return hasAppleIntegrations
  }
  if (id === 'agents') {
    return isMacosDesktop
  }
  if (id === 'search') {
    return showAdvanced
  }
  if (id === 'vault-compat' || id === 'obsidian-import') {
    return getVaultLayout().obsidian
  }
  return true
}

function useHasAppleIntegrations(): boolean {
  const authorization = useContactsAuthorization()
  return isMacosDesktop || (authorization !== null && authorization !== 'unavailable')
}

/**
 * The settings groups this platform actually shows, in page order.
 * Integrations only exists where the OS frameworks do (macOS/iOS — the Rust
 * shell answers `unavailable` elsewhere). Agents is macOS-only. Search
 * (embeddings) stays hidden until the graph has enough notes. Obsidian
 * compatibility only exists for a vault Obsidian also opens.
 * The navigator must agree with the page, so both filter through here
 * rather than reading the registry directly.
 */
export function useVisibleSettingsGroups(): readonly VisibleSettingsGroup[] {
  const hasAppleIntegrations = useHasAppleIntegrations()
  const showAdvanced = useShowAdvancedSurfaces()
  return SETTINGS_GROUPS.map((group) => {
    const sections: readonly SettingsSectionEntry[] = group.sections
    return {
      id: group.id,
      title: group.title,
      sections: sections.filter((section) =>
        sectionIsVisible(section.id, hasAppleIntegrations, showAdvanced),
      ),
    }
  }).filter((group) => group.sections.length > 0)
}
