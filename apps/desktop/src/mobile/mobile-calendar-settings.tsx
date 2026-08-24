import { useId, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { canReadCalendars, listCalendars, requestCalendarAccess } from '@reflect/core'
import { openUrlSync } from '@/lib/open-url'
import {
  CALENDAR_QUERY_PREFIX,
  useCalendarAuthorization,
  useCalendarChangeInvalidation,
} from '@/lib/use-calendar'
import { SettingsActionRow, SettingsGroup, SettingsSwitchRow } from '@/mobile/settings-list'
import { useSettings } from '@/providers/settings-provider'

/**
 * iOS Calendar switch: grant EventKit, then enable every calendar so the
 * daily spine can one-tap a meeting note.
 */
export function MobileCalendarSettings(): ReactElement {
  const { settings, updateSettings } = useSettings()
  const queryClient = useQueryClient()
  const footerId = useId()
  const status = useCalendarAuthorization(settings.calendarEnabled)
  useCalendarChangeInvalidation(settings.calendarEnabled)
  const denied = settings.calendarEnabled && status !== undefined && !canReadCalendars(status)

  async function enableCalendars(): Promise<void> {
    updateSettings({ calendarEnabled: true })
    try {
      const granted = await requestCalendarAccess()
      if (!granted) {
        return
      }
      const calendars = await listCalendars()
      updateSettings({
        calendarEnabled: true,
        calendarIds: calendars.map((calendar) => calendar.id),
      })
    } catch {
      // The switch stays on; a denied status shows Open Settings after refresh.
    } finally {
      void queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_PREFIX })
    }
  }

  return (
    <SettingsGroup
      header="Calendar"
      footer="Today’s meetings appear on the daily note. One tap creates a meeting note. Access stays on this device."
      footerId={footerId}
    >
      <SettingsSwitchRow
        label="Show today’s meetings"
        checked={settings.calendarEnabled}
        descriptionId={footerId}
        onCheckedChange={(checked) => {
          if (checked) {
            void enableCalendars()
          } else {
            updateSettings({ calendarEnabled: false })
          }
        }}
      />
      {denied ? (
        <SettingsActionRow
          label="Open Settings"
          onPress={() => {
            openUrlSync('app-settings:')
          }}
        />
      ) : null}
    </SettingsGroup>
  )
}
