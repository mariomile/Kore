import type { ReactElement } from 'react'
import type {
  AccentColor,
  GlassIntensity,
  ThemePreference,
  UiDensity,
  UiRadius,
} from '@reflect/core'
import {
  ACCENT_COLOR_IDS,
  ACCENT_SWATCH_HEX,
  GLASS_INTENSITY_IDS,
  UI_DENSITY_IDS,
  UI_RADIUS_IDS,
} from '@reflect/core'
import {
  Contrast,
  Monitor,
  Moon,
  MoonStars,
  Notebook,
  Sparkles,
  Sun,
  SunDim,
  type Icon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import { SettingsField } from './field'
import { SettingsOptionCard } from './option-card'
import { SettingsSection } from './section'
import { SettingsSwitchField } from './switch-field'

interface ThemeOption {
  value: ThemePreference
  label: string
  icon: Icon
}

// Ordered the way the families read: the OS default, then light to dark.
const THEME_OPTIONS: ThemeOption[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'ash', label: 'Ash', icon: SunDim },
  { value: 'paper', label: 'Paper', icon: Notebook },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'graphite', label: 'Graphite', icon: Contrast },
  { value: 'space', label: 'Space', icon: Sparkles },
  { value: 'midnight', label: 'Midnight', icon: MoonStars },
]

type PresetAccentColor = Exclude<AccentColor, 'custom'>

// Swatch fills come from the shared `ACCENT_SWATCH_HEX` map (a static map
// rather than the live CSS variable so every swatch shows its own hue, not
// the applied one).
const ACCENT_LABELS: Record<PresetAccentColor, string> = {
  indigo: 'Indigo',
  violet: 'Violet',
  purple: 'Purple',
  pink: 'Pink',
  rose: 'Rose',
  red: 'Red',
  orange: 'Orange',
  amber: 'Amber',
  lime: 'Lime',
  green: 'Green',
  emerald: 'Emerald',
  teal: 'Teal',
  cyan: 'Cyan',
  sky: 'Sky',
  blue: 'Blue',
  slate: 'Slate',
}

/**
 * Corner-radius steps. The preview is a wide rectangle with a hand-picked
 * radius rather than a square carrying the live token: at swatch scale the
 * real ramp rounds a square into a circle by `default`, so all four steps
 * would look alike. A 20×32 box keeps a straight edge at every step.
 *
 * The labels are single words that repeat elsewhere on this screen (the editor
 * text-size steps are also Small/Large), so each radio's accessible name is
 * prefixed with the field — otherwise neither is reachable by name.
 */
const RADIUS_OPTIONS: Record<UiRadius, { label: string; preview: string }> = {
  sharp: { label: 'Sharp', preview: '0px' },
  small: { label: 'Small', preview: '2px' },
  default: { label: 'Default', preview: '6px' },
  round: { label: 'Round', preview: '10px' },
}

/**
 * Density labels. It changes list-row height and sidebar padding — not a
 * global scale — so the copy says what moves rather than promising the app
 * will shrink whole.
 */
const DENSITY_LABELS: Record<UiDensity, string> = {
  compact: 'Compact',
  default: 'Default',
  comfortable: 'Comfortable',
}

const GLASS_INTENSITY_LABELS: Record<GlassIntensity, string> = {
  subtle: 'Subtle',
  regular: 'Regular',
  strong: 'Strong',
}

/**
 * Theme picker as radio cards (the original app's idiom) plus the accent
 * color swatch row, the corner-radius steps, and the Liquid Glass switch with
 * its intensity. Edits the settings document directly — the ThemeProvider
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
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                <Icon aria-hidden className="size-4" />
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
                  style={{ backgroundColor: ACCENT_SWATCH_HEX[accent] }}
                />
              </label>
            )
          })}
          <label
            title="Custom"
            className={cn(
              'flex size-8 cursor-pointer items-center justify-center rounded-full border transition-colors duration-100',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus-ring',
              settings.accentColor === 'custom'
                ? 'border-text'
                : 'border-transparent hover:border-border-strong',
            )}
          >
            <input
              type="radio"
              name="accent-color"
              value="custom"
              checked={settings.accentColor === 'custom'}
              onChange={() => updateSettings({ accentColor: 'custom' })}
              className="sr-only"
              aria-label="Custom"
            />
            <span
              aria-hidden
              className="size-5 rounded-full"
              style={{
                background:
                  settings.accentColor === 'custom'
                    ? settings.customAccentColor
                    : 'conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #8b5cf6, #ef4444)',
              }}
            />
          </label>
          {settings.accentColor === 'custom' ? (
            <input
              type="color"
              aria-label="Custom accent color"
              value={settings.customAccentColor}
              onChange={(event) => updateSettings({ customAccentColor: event.target.value })}
              className="h-8 w-12 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
            />
          ) : null}
        </div>
      </SettingsField>

      <SettingsField
        legend="Corners"
        description="How round every surface is — buttons, cards, dialogs, and inputs move together."
      >
        <div className="mt-3 grid grid-cols-4 gap-2">
          {UI_RADIUS_IDS.map((radius) => {
            const { label, preview } = RADIUS_OPTIONS[radius]
            const selected = settings.uiRadius === radius
            return (
              <SettingsOptionCard
                key={radius}
                selected={selected}
                className={cn(
                  'flex-col items-center gap-1.5 px-3 py-3',
                  selected ? 'text-accent-soft-text' : 'text-text-secondary',
                )}
              >
                <input
                  type="radio"
                  name="ui-radius"
                  value={radius}
                  checked={selected}
                  onChange={() => updateSettings({ uiRadius: radius })}
                  className="sr-only"
                  aria-label={`Corners: ${label}`}
                />
                <span
                  aria-hidden
                  className="h-5 w-8 border-[1.5px] border-current"
                  style={{ borderRadius: preview }}
                />
                <span className="text-xs font-medium">{label}</span>
              </SettingsOptionCard>
            )
          })}
        </div>
      </SettingsField>

      <SettingsField
        legend="Density"
        description="How tightly rows are packed in lists and the sidebar."
      >
        <div className="mt-3 grid grid-cols-3 gap-2">
          {UI_DENSITY_IDS.map((density) => {
            const selected = settings.uiDensity === density
            return (
              <SettingsOptionCard
                key={density}
                selected={selected}
                className={cn(
                  'items-center justify-center px-3 py-2',
                  selected ? 'text-accent-soft-text' : 'text-text-secondary',
                )}
              >
                <input
                  type="radio"
                  name="ui-density"
                  value={density}
                  checked={selected}
                  onChange={() => updateSettings({ uiDensity: density })}
                  className="sr-only"
                  aria-label={`Density: ${DENSITY_LABELS[density]}`}
                />
                <span className="text-xs font-medium">{DENSITY_LABELS[density]}</span>
              </SettingsOptionCard>
            )
          })}
        </div>
      </SettingsField>

      <SettingsSwitchField
        legend="Liquid Glass"
        description="Translucent, blurred surfaces over an accent-tinted backdrop — works with every theme."
        checked={settings.liquidGlass}
        onCheckedChange={(checked) => updateSettings({ liquidGlass: checked })}
      />

      {settings.liquidGlass ? (
        <SettingsField
          legend="Glass intensity"
          description="How far the tint and blur go. Subtle keeps a busy vault readable behind the chrome."
        >
          <div className="mt-3 grid grid-cols-3 gap-2">
            {GLASS_INTENSITY_IDS.map((intensity) => {
              const selected = settings.glassIntensity === intensity
              return (
                <SettingsOptionCard
                  key={intensity}
                  selected={selected}
                  className={cn(
                    'items-center justify-center px-3 py-2',
                    selected ? 'text-accent-soft-text' : 'text-text-secondary',
                  )}
                >
                  <input
                    type="radio"
                    name="glass-intensity"
                    value={intensity}
                    checked={selected}
                    onChange={() => updateSettings({ glassIntensity: intensity })}
                    className="sr-only"
                  />
                  <span className="text-xs font-medium">{GLASS_INTENSITY_LABELS[intensity]}</span>
                </SettingsOptionCard>
              )
            })}
          </div>
        </SettingsField>
      ) : null}
    </SettingsSection>
  )
}
