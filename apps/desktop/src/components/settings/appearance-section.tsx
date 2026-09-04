import type { ReactElement, ReactNode } from 'react'
import type {
  AccentColor,
  ChatTextSize,
  EditorTextSize,
  GlassIntensity,
  ThemePreference,
  UiDensity,
  UiRadius,
  UiTextSize,
  VisualTheme,
} from '@reflect/core'
import {
  ACCENT_COLOR_IDS,
  ACCENT_SWATCH_HEX,
  CHAT_TEXT_SIZE_IDS,
  EDITOR_TEXT_SIZE_IDS,
  GLASS_INTENSITY_IDS,
  UI_DENSITY_IDS,
  UI_RADIUS_IDS,
  UI_TEXT_SIZE_IDS,
} from '@reflect/core'
import {
  Book,
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
  { value: 'ink', label: 'Ink', icon: Book },
  { value: 'space', label: 'Space', icon: Sparkles },
  { value: 'midnight', label: 'Midnight', icon: MoonStars },
  { value: 'codex', label: 'Codex', icon: Contrast },
]

const VISUAL_THEME_OPTIONS: readonly {
  value: VisualTheme
  label: string
  preview: ReactNode
}[] = [
  {
    value: 'default',
    label: 'Default',
    preview: (
      <span aria-hidden className="flex h-8 w-14 gap-1 rounded-md border border-current p-1">
        <span className="w-3 rounded-sm bg-current opacity-30" />
        <span className="flex-1 rounded-sm bg-current opacity-15" />
      </span>
    ),
  },
  {
    value: 'liquid-glass',
    label: 'Liquid Glass',
    preview: (
      <span
        aria-hidden
        className="flex h-8 w-14 gap-1 rounded-xl border border-current bg-gradient-to-br from-current/25 to-transparent p-1 shadow-sm"
      >
        <span className="w-3 rounded-lg bg-current opacity-25" />
        <span className="flex-1 rounded-lg border border-current opacity-40" />
      </span>
    ),
  },
  {
    value: 'flat',
    label: 'Flat',
    preview: (
      <span aria-hidden className="flex h-8 w-14 overflow-hidden border border-current">
        <span className="w-3 border-r border-current bg-current/20" />
        <span className="flex-1" />
        <span className="w-3 border-l border-current bg-current/20" />
      </span>
    ),
  },
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

const UI_TEXT_SIZE_LABELS: Record<UiTextSize, string> = {
  small: 'Small',
  default: 'Default',
  large: 'Large',
}

const EDITOR_TEXT_SIZE_LABELS: Record<EditorTextSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
}

const CHAT_TEXT_SIZE_LABELS: Record<ChatTextSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
}

interface RadioCardOption<T extends string> {
  value: T
  label: string
  /** Overrides the accessible name where the visible label collides app-wide. */
  ariaLabel?: string
  /** Icon or preview shown above the label. */
  adornment?: ReactNode
}

/**
 * One radio-card grid, shared by all four Appearance choice fields. They were
 * four hand-written copies of the same skeleton before, and the copies had
 * already drifted (one field's radios lacked their accessible-name prefix);
 * the selected/unselected treatment, the sr-only input, and the focus lift
 * now exist once.
 */
function SettingsRadioCards<T extends string>({
  name,
  value,
  options,
  onChange,
  columns,
}: {
  name: string
  value: T
  options: readonly RadioCardOption<T>[]
  onChange: (next: T) => void
  /** The grid template, e.g. `grid-cols-3` — column count is per field. */
  columns: string
}): ReactElement {
  return (
    <div className={cn('mt-3 grid gap-2', columns)}>
      {options.map((option) => {
        const selected = value === option.value
        return (
          <SettingsOptionCard
            key={option.value}
            selected={selected}
            className={cn(
              option.adornment === undefined
                ? 'items-center justify-center px-3 py-2'
                : 'flex-col items-center gap-1.5 px-3 py-3',
              selected ? 'text-accent-soft-text' : 'text-text-secondary',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
              {...(option.ariaLabel === undefined ? {} : { 'aria-label': option.ariaLabel })}
            />
            {option.adornment}
            <span className="text-xs font-medium">{option.label}</span>
          </SettingsOptionCard>
        )
      })}
    </div>
  )
}

/**
 * Visual-theme and color-scheme pickers plus the accent color, optional
 * geometry controls, Liquid Glass intensity, and haptics. Edits the settings document directly —
 * the ThemeProvider applies whatever is persisted, so this section needs no
 * theme context of its own.
 */
export function AppearanceSection(): ReactElement {
  const { settings, updateSettings } = useSettings()

  return (
    <SettingsSection id="appearance">
      <SettingsField
        legend="Theme"
        description="Changes Kore’s surfaces, materials, and geometry as one coherent style."
      >
        <SettingsRadioCards
          name="visual-theme"
          value={settings.visualTheme}
          options={VISUAL_THEME_OPTIONS.map(({ value, label, preview }) => ({
            value,
            label,
            adornment: preview,
          }))}
          onChange={(visualTheme) => updateSettings({ visualTheme })}
          columns="grid-cols-1 sm:grid-cols-3"
        />
      </SettingsField>

      <SettingsField
        legend="Color scheme"
        description="System follows your OS appearance. Saved with your settings."
      >
        <SettingsRadioCards
          name="theme"
          value={settings.theme}
          options={THEME_OPTIONS.map(({ value, label, icon: Icon }) => ({
            value,
            label,
            adornment: <Icon aria-hidden className="size-4" />,
          }))}
          onChange={(theme) => updateSettings({ theme })}
          columns="grid-cols-2 sm:grid-cols-4"
        />
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

      {settings.visualTheme !== 'liquid-glass' ? (
        <SettingsField
          legend="Corners"
          description={
            settings.visualTheme === 'flat'
              ? 'Rounds controls, cards, and dialogs. Workspace panels stay square in Flat.'
              : 'How round every surface is — buttons, cards, dialogs, and inputs move together.'
          }
        >
          <SettingsRadioCards
            name="ui-radius"
            value={settings.uiRadius}
            options={UI_RADIUS_IDS.map((radius) => ({
              value: radius,
              label: RADIUS_OPTIONS[radius].label,
              ariaLabel: `Corners: ${RADIUS_OPTIONS[radius].label}`,
              adornment: (
                <span
                  aria-hidden
                  className="h-5 w-8 border-[1.5px] border-current"
                  style={{ borderRadius: RADIUS_OPTIONS[radius].preview }}
                />
              ),
            }))}
            onChange={(uiRadius) => updateSettings({ uiRadius })}
            columns="grid-cols-4"
          />
        </SettingsField>
      ) : null}

      <SettingsField
        legend="Text size"
        description="How big type renders — the interface chrome, the note editor, and the AI chat each get their own step."
      >
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-text-secondary">Interface</p>
            <SettingsRadioCards
              name="ui-text-size"
              value={settings.uiTextSize}
              options={UI_TEXT_SIZE_IDS.map((size) => ({
                value: size,
                label: UI_TEXT_SIZE_LABELS[size],
                // Small/Default/Large repeat across this field's three rows
                // (and elsewhere on the screen), so the accessible name
                // carries the row.
                ariaLabel: `Interface text size: ${UI_TEXT_SIZE_LABELS[size]}`,
              }))}
              onChange={(uiTextSize) => updateSettings({ uiTextSize })}
              columns="grid-cols-3"
            />
          </div>
          <div>
            <p className="text-xs font-medium text-text-secondary">Notes</p>
            <SettingsRadioCards
              name="appearance-editor-text-size"
              value={settings.editorTextSize}
              options={EDITOR_TEXT_SIZE_IDS.map((size) => ({
                value: size,
                label: EDITOR_TEXT_SIZE_LABELS[size],
                ariaLabel: `Note text size: ${EDITOR_TEXT_SIZE_LABELS[size]}`,
              }))}
              onChange={(editorTextSize) => updateSettings({ editorTextSize })}
              columns="grid-cols-3"
            />
          </div>
          <div>
            <p className="text-xs font-medium text-text-secondary">Chat</p>
            <SettingsRadioCards
              name="chat-text-size"
              value={settings.chatTextSize}
              options={CHAT_TEXT_SIZE_IDS.map((size) => ({
                value: size,
                label: CHAT_TEXT_SIZE_LABELS[size],
                ariaLabel: `Chat text size: ${CHAT_TEXT_SIZE_LABELS[size]}`,
              }))}
              onChange={(chatTextSize) => updateSettings({ chatTextSize })}
              columns="grid-cols-3"
            />
          </div>
        </div>
      </SettingsField>

      <SettingsField
        legend="Density"
        description="How tightly rows are packed in lists and the sidebar."
      >
        <SettingsRadioCards
          name="ui-density"
          value={settings.uiDensity}
          options={UI_DENSITY_IDS.map((density) => ({
            value: density,
            label: DENSITY_LABELS[density],
            // "Default" collides with the Corners step of the same name.
            ariaLabel: `Density: ${DENSITY_LABELS[density]}`,
          }))}
          onChange={(uiDensity) => updateSettings({ uiDensity })}
          columns="grid-cols-3"
        />
      </SettingsField>

      {settings.visualTheme === 'liquid-glass' ? (
        <SettingsField
          legend="Glass intensity"
          description="Adjusts the translucency of menus and popovers above the system material."
        >
          <SettingsRadioCards
            name="glass-intensity"
            value={settings.glassIntensity}
            options={GLASS_INTENSITY_IDS.map((intensity) => ({
              value: intensity,
              label: GLASS_INTENSITY_LABELS[intensity],
            }))}
            onChange={(glassIntensity) => updateSettings({ glassIntensity })}
            columns="grid-cols-3"
          />
        </SettingsField>
      ) : null}

      <SettingsSwitchField
        legend="Haptic feedback"
        description="Trackpad knocks when a switch flips, a panel snaps into place, or an action fails. Needs a Force Touch trackpad."
        checked={settings.hapticFeedback}
        onCheckedChange={(checked) => updateSettings({ hapticFeedback: checked })}
      />
    </SettingsSection>
  )
}
