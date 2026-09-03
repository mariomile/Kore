import type { ReactElement } from 'react'
import {
  ACCENT_COLOR_IDS,
  ACCENT_SWATCH_HEX,
  THEME_PREFERENCE_IDS,
  UI_RADIUS_IDS,
  type AccentColor,
  type EditorFontFamily,
  type EditorLineSpacing,
  type EditorTextSize,
  type ThemePreference,
  type UiRadius,
} from '@reflect/core'
import {
  SettingsChipsRow,
  SettingsGroup,
  SettingsSegmentedRow,
  SettingsSwatchRow,
  SettingsSwitchRow,
  type SegmentedOption,
  type SwatchOption,
} from '@/mobile/settings-list'
import { useSettings } from '@/providers/settings-provider'

// Every closed choice below is derived from the settings schema's id list
// rather than repeated as a hand-written subset: the label maps are
// exhaustive, so an id added to an enum fails the build until it is named
// here, and the picker cannot silently fall behind the desktop one.
const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  ash: 'Ash',
  paper: 'Paper',
  dark: 'Dark',
  graphite: 'Graphite',
  ink: 'Ink',
  space: 'Space',
  midnight: 'Midnight',
}

const THEME_OPTIONS: readonly SegmentedOption<ThemePreference>[] = THEME_PREFERENCE_IDS.map(
  (id) => ({ value: id, label: THEME_LABELS[id] }),
)

const UI_RADIUS_LABELS: Record<UiRadius, string> = {
  sharp: 'Sharp',
  small: 'Small',
  default: 'Default',
  round: 'Round',
}

const UI_RADIUS_OPTIONS: readonly SegmentedOption<UiRadius>[] = UI_RADIUS_IDS.map((id) => ({
  value: id,
  label: UI_RADIUS_LABELS[id],
}))

// Swatch fills come from the shared `ACCENT_SWATCH_HEX` map. The `custom`
// accent is desktop-configured; mobile offers the presets.
const ACCENT_OPTIONS: readonly SwatchOption<AccentColor>[] = ACCENT_COLOR_IDS.map((id) => ({
  value: id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
  color: ACCENT_SWATCH_HEX[id],
}))

const TEXT_SIZE_OPTIONS: readonly SegmentedOption<EditorTextSize>[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
]

const FONT_FAMILY_OPTIONS: readonly SegmentedOption<EditorFontFamily>[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'system', label: 'System' },
  { value: 'mono', label: 'Mono' },
]

const LINE_SPACING_OPTIONS: readonly SegmentedOption<EditorLineSpacing>[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'relaxed', label: 'Relaxed' },
]

/**
 * The Appearance section of the mobile Settings screen — the phone's leg of
 * desktop's `AppearanceSection`. Every row edits the shared settings
 * document; the `ThemeProvider` above both surfaces applies whatever is
 * persisted, so nothing here needs theme context of its own.
 *
 * Only the choices that carry to a phone are offered: the custom accent
 * (a color input) stays desktop-configured, and the presets stand in for it.
 * The haptics switch is the same shared key desktop exposes — off silences
 * the taps, checkbox ticks, and confirmations this app fires.
 */
export function MobileAppearanceGroup(): ReactElement {
  const { settings, updateSettings } = useSettings()

  return (
    <SettingsGroup header="Appearance">
      <SettingsChipsRow
        label="Theme"
        value={settings.theme}
        options={THEME_OPTIONS}
        onChange={(theme) => updateSettings({ theme })}
      />
      <SettingsSwatchRow
        label="Accent color"
        value={settings.accentColor}
        options={ACCENT_OPTIONS}
        onChange={(accentColor) => updateSettings({ accentColor })}
      />
      <SettingsSegmentedRow
        label="Text size"
        value={settings.editorTextSize}
        options={TEXT_SIZE_OPTIONS}
        onChange={(editorTextSize) => updateSettings({ editorTextSize })}
      />
      <SettingsChipsRow
        label="Font"
        value={settings.editorFontFamily}
        options={FONT_FAMILY_OPTIONS}
        onChange={(editorFontFamily) => updateSettings({ editorFontFamily })}
      />
      <SettingsChipsRow
        label="Line spacing"
        value={settings.editorLineSpacing}
        options={LINE_SPACING_OPTIONS}
        onChange={(editorLineSpacing) => updateSettings({ editorLineSpacing })}
      />
      <SettingsChipsRow
        label="Corners"
        value={settings.uiRadius}
        options={UI_RADIUS_OPTIONS}
        onChange={(uiRadius) => updateSettings({ uiRadius })}
      />
      <SettingsSwitchRow
        label="Haptic feedback"
        checked={settings.hapticFeedback}
        onCheckedChange={(hapticFeedback) => updateSettings({ hapticFeedback })}
      />
    </SettingsGroup>
  )
}
