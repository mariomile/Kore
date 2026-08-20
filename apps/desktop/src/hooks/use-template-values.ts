import { useCallback } from 'react'
import {
  displayNoteTitle,
  getNote,
  noteFileStem,
  type TemplatePlaceholderValues,
} from '@reflect/core'
import { formatDayLabel, formatTimeOfDay } from '@/lib/dates'
import { useToday } from '@/lib/use-today'
import { useSettings } from '@/providers/settings-provider'

/**
 * A resolver for template placeholder values, evaluated at insertion time so
 * `{{time}}` reads the live clock rather than the render that opened the
 * picker. `{{title}}` is the target note's display title from the index (the
 * file stem while the row is loading or the index is rebuilding — the same
 * fallback the tab strip uses); the date and time honor the user's format
 * settings.
 */
export function useTemplateValues(): (
  notePath: string | null,
) => Promise<TemplatePlaceholderValues> {
  const { settings } = useSettings()
  const today = useToday()
  const { dateFormat, timeFormat } = settings

  return useCallback(
    async (notePath) => {
      let title = ''
      if (notePath !== null) {
        title = noteFileStem(notePath)
        try {
          title = displayNoteTitle((await getNote(notePath))?.title ?? title)
        } catch {
          // The index can be mid-rebuild; the stem still names the note.
        }
      }
      return {
        title,
        date: formatDayLabel(today, dateFormat),
        dateIso: today,
        time: formatTimeOfDay(new Date(), timeFormat),
      }
    },
    [dateFormat, timeFormat, today],
  )
}
