import { useCallback, type MouseEvent } from 'react'
import type { IsoWeek } from '@kore/core'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { weeklyRoute } from '@/routing/route'
import { isModEvent } from '@meowdown/core'

/**
 * Open a week's note the way every note link opens: in place, or in the pane
 * beside this one on ⌘-click. The one entry every week control shares (the
 * stream's eyebrow, the Details card, the calendar's week numbers).
 */
export function useOpenWeek(): (week: IsoWeek, event: MouseEvent) => void {
  const navigateNoteLink = useNoteLinkNavigation()
  return useCallback(
    (week, event) => {
      navigateNoteLink({ target: weeklyRoute(week), openInSplit: isModEvent(event) })
    },
    [navigateNoteLink],
  )
}
