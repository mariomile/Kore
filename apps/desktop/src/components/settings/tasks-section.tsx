import type { ReactElement } from 'react'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { useSettings } from '@/providers/settings-provider'
import { SettingsSection } from './section'
import { SettingsSwitchField } from './switch-field'

/**
 * The Tasks settings: reminders for due tasks. Turning the switch on also
 * asks the OS for notification permission — a denied request leaves the
 * setting on but notifications silently withheld until the user grants it
 * in System Settings, which matches how macOS treats every app.
 */
export function TasksSection(): ReactElement {
  const { settings, updateSettings } = useSettings()

  const setReminders = (checked: boolean): void => {
    updateSettings({ taskReminders: checked })
    if (checked) {
      void isPermissionGranted()
        .then((granted) => (granted ? 'granted' : requestPermission()))
        .catch(() => undefined)
    }
  }

  return (
    <SettingsSection id="tasks">
      <SettingsSwitchField
        legend="Due-task reminders"
        description="A daily summary of date-only due and overdue tasks, plus a notification at the @HH:MM on a timed task."
        checked={settings.taskReminders}
        onCheckedChange={setReminders}
      />
    </SettingsSection>
  )
}
