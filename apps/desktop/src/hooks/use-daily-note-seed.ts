import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { expandTemplatePlaceholders, readNote, splitFrontmatter } from '@reflect/core'
import { formatDayLabel, formatTimeOfDay, todayIso } from '@/lib/dates'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

/** Where a daily note's starting shape lives, by convention. */
export const DAILY_TEMPLATE_PATH = 'templates/daily.md'

/**
 * The markdown a daily note starts life with, or undefined when there is no
 * `templates/daily.md` — the template system's one piece that was designed
 * and then deferred (docs/porting/note-templates.md).
 *
 * It is delivered as the session's `missingSeed`, not written on open. The
 * seed is adopted as the clean dirty-comparison baseline, so a day that shows
 * the template but is never touched still writes nothing: Plan 06's lazy
 * daily contract — opening a day never litters the graph, writing does —
 * survives intact. You see the shape; the file appears when you use it.
 *
 * **Only today and the days ahead are seeded.** A past day you never wrote in
 * isn't a daily note waiting to be started, it's a day that didn't happen
 * here; painting a skeleton over every empty day behind you rewrites the
 * stream's history into a wall of identical headings. Days you can still
 * start get the template. That is the one predicate below, if it ever wants
 * changing.
 */
export function useDailyNoteSeed(date: string): string | undefined {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const { dateFormat, timeFormat } = settings
  const startable = date >= todayIso()
  // Read once when the row mounts, not on every render — reading the clock
  // during render is impure. A `{{time}}` in a *daily* template therefore
  // means "when this day came on screen" rather than "when you typed", which
  // is the honest reading for a note whose identity is the whole day; a
  // meeting template inserted at the cursor still resolves the live clock.
  const [mountedAt] = useState(() => formatTimeOfDay(new Date(), timeFormat))

  const { data: template } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'daily-template'],
    // Shared across every mounted day in the stream: one read, not one per row.
    queryFn: async () => {
      try {
        // Frontmatter is a template's metadata, never its content — the same
        // rule `templateBody` applies to an inserted template.
        return splitFrontmatter(await readNote(DAILY_TEMPLATE_PATH)).body
      } catch {
        return null // no daily template — dailies open empty, as before
      }
    },
    enabled: graph !== null && startable,
  })

  if (!startable || template === null || template === undefined || template.trim() === '') {
    return undefined
  }
  return expandTemplatePlaceholders(template, {
    // A daily note's title *is* its date, and `{{date}}` should read as the
    // day the note belongs to rather than the day it happens to be opened —
    // otherwise tomorrow's page, opened tonight, dates itself today.
    title: formatDayLabel(date, dateFormat),
    date: formatDayLabel(date, dateFormat),
    dateIso: date,
    time: mountedAt,
  })
}
