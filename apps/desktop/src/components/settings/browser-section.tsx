import type { ReactElement } from 'react'
import type { BrowserSearchEngine } from '@reflect/core'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import { SettingsField } from './field'
import { SettingsOptionCard } from './option-card'
import { SettingsSection } from './section'
import { SettingsSwitchField } from './switch-field'

interface SearchEngineOption {
  value: BrowserSearchEngine
  label: string
  description: string
}

const SEARCH_ENGINE_OPTIONS: SearchEngineOption[] = [
  {
    value: 'duckduckgo',
    label: 'DuckDuckGo',
    description: 'Private search, the default',
  },
  {
    value: 'google',
    label: 'Google',
    description: 'google.com',
  },
  {
    value: 'bing',
    label: 'Bing',
    description: 'bing.com',
  },
]

/**
 * In-app browser preferences: the search engine for the new-tab field, and
 * whether web links in notes open here or in the OS browser.
 */
export function BrowserSection(): ReactElement {
  const { settings, updateSettings } = useSettings()

  return (
    <SettingsSection id="browser">
      <SettingsField
        legend="Search engine"
        description="Used when you type a query instead of a URL in the Browser tab."
      >
        <div className="mt-3 @container">
          <div className="grid grid-cols-1 gap-2 @xl:grid-cols-3">
            {SEARCH_ENGINE_OPTIONS.map((option) => {
              const selected = settings.browserSearchEngine === option.value
              return (
                <SettingsOptionCard
                  key={option.value}
                  selected={selected}
                  className="items-start justify-between gap-3 px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-sm font-medium',
                        selected && 'text-accent-soft-text',
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                      {option.description}
                    </span>
                  </span>
                  <input
                    type="radio"
                    name="browser-search-engine"
                    value={option.value}
                    checked={selected}
                    onChange={() => updateSettings({ browserSearchEngine: option.value })}
                    className="mt-0.5 shrink-0 accent-accent"
                  />
                </SettingsOptionCard>
              )
            })}
          </div>
        </div>
      </SettingsField>

      <SettingsSwitchField
        legend="Open links in the in-app browser"
        description="Web links in notes open here. Alt-click always does the opposite."
        checked={settings.browserOpenLinksInApp}
        onCheckedChange={(browserOpenLinksInApp) => updateSettings({ browserOpenLinksInApp })}
      />
    </SettingsSection>
  )
}
