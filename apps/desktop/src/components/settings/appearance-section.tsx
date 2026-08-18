import type { ReactElement } from 'react'
import type { AccentColor, ThemePreference } from '@reflect/core'
import { ACCENT_COLOR_IDS } from '@reflect/core'
import { Feather, Monitor, Moon, MoonStar, Sparkles, Sun, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import { SettingsField } from './field'
import { SettingsOptionCard } from './option-card'
import { SettingsSection } from './section'

interface ThemeOption {
  value: ThemePreference
  label: string
  icon: LucideIcon
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'space', label: 'Space', icon: Sparkles },
  { value: 'midnight', label: 'Midnight', icon: MoonStar },
  { value: 'paper', label: 'Paper', icon: Feather },
]

/**
 * The swatch each accent id paints in the picker: the light-theme `--accent`
 * value from the design-system ramps. A static map rather than the live CSS
 * variable so every swatch shows its own hue, not the currently applied one.
 */
const ACCENT_SWATCHES: Record<AccentColor, string> = {
  indigo: '#4f46e5',
  purple: '#7c3aed',
  blue: '#2563eb',
  teal: '#0d9488',
  green: '#059669',
  amber: '#d97706',
  rose: '#e11d48',
  red: '#dc2626',
}

const ACCENT_LABELS: Record<AccentColor, string> = {
  indigo: 'Indigo',
  purple: 'Purple',
  blue: 'Blue',
  teal: 'Teal',
  green: 'Green',
  amber: 'Amber',
  rose: 'Rose',
  red: 'Red',
}

/**
 * Theme picker as radio cards (the original app's idiom) plus the accent
 * color swatch row. Edits the settings document directly — the ThemeProvider
 * applies whatever is persisted, so this section needs no theme context of
 * its own.
 */
export function AppearanceSection(): ReactElement {
  const { settings, updateSettings } = useSettings()

  return (
    <SettingsSection id="appearance">
      <SettingsField
        legend="Theme"
        description="System follows your OS appearance. Saved with your settings."
      >
        <div className="mt-3 grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const selected = settings.theme === value
            return (
              <SettingsOptionCard
                key={value}
                selected={selected}
                className={cn(
                  'flex-col items-center gap-1.5 px-3 py-3',
                  selected ? 'text-accent-soft-text' : 'text-text-secondary',
                )}
              >
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={selected}
                  onChange={() => updateSettings({ theme: value })}
                  className="sr-only"
                />
                <Icon aria-hidden strokeWidth={1.75} className="size-4" />
                <span className="text-xs font-medium">{label}</span>
              </SettingsOptionCard>
            )
          })}
        </div>
      </SettingsField>

      <SettingsField
        legend="Accent color"
        description="The highlight color for buttons, selection, and today's date."
      >
        <div className="mt-3 flex flex-wrap gap-2">
          {ACCENT_COLOR_IDS.map((accent) => {
            const selected = settings.accentColor === accent
            return (
              <label
                key={accent}
                title={ACCENT_LABELS[accent]}
                className={cn(
                  'flex size-8 cursor-pointer items-center justify-center rounded-full border transition-colors duration-100',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus-ring',
                  selected ? 'border-text' : 'border-transparent hover:border-border-strong',
                )}
              >
                <input
                  type="radio"
                  name="accent-color"
                  value={accent}
                  checked={selected}
                  onChange={() => updateSettings({ accentColor: accent })}
                  className="sr-only"
                  aria-label={ACCENT_LABELS[accent]}
                />
                <span
                  aria-hidden
                  className="size-5 rounded-full"
                  style={{ backgroundColor: ACCENT_SWATCHES[accent] }}
                />
              </label>
            )
          })}
        </div>
      </SettingsField>
    </SettingsSection>
  )
}
