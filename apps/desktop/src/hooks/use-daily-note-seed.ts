import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  DEFAULT_VAULT_LAYOUT,
  expandTemplatePlaceholders,
  formatIsoDate,
  formatMoment,
  getVaultLayout,
  readNote,
} from '@reflect/core'
import { formatDayLabel, formatTimeOfDay, todayIso } from '@/lib/dates'
import { templateBody } from '@/lib/note-templates'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

/**
 * Where a daily note's starting shape lives: `templates/daily.md` by
 * convention, or the template an adopted Obsidian vault names.
 */
export function dailyTemplatePath(): string {
  return getVaultLayout().dailyTemplate
}

/**
 * The template's markdown as a daily starts from it. Kore's own template
 * drops its frontmatter (metadata, never content), exactly as an inserted
 * template does; a vault's Obsidian template is copied whole, the way
 * Obsidian copies it, so its `tags:` and properties reach the new daily.
 */
async function dailyTemplateSource(path: string): Promise<string> {
  return path === DEFAULT_VAULT_LAYOUT.dailyTemplate
    ? await templateBody(path)
    : await readNote(path)
}

/**
 * Where Keep should write when the open note is showing conflict markers.
 * A missing daily's markers came from {@link dailyTemplatePath} (the seed);
 * writing the daily path would create one day's file and leave the template
 * conflicted for every later morning.
 */
export function dailyConflictWritePath(
  path: string,
  options: { readonly dailyNote: boolean; readonly missing: boolean },
): string {
  if (options.dailyNote && options.missing) {
    return dailyTemplatePath()
  }
  return path
}

/**
 * The markdown a daily note starts life with, or undefined when there is no
 * daily template ({@link dailyTemplatePath}) — the template system's one piece that was designed
 * and then deferred (docs/porting/note-templates.md).
 *
 * It is delivered as the session's `missingSeed`, not written on open. The
 * seed is adopted as the clean dirty-comparison baseline, so a day that shows
 * the template but is never touched still writes nothing: Plan 06's lazy
 * daily contract — opening a day never litters the graph, writing does —
 * survives intact. You see the shape; the file appears when you use it.
 *
 * **Only today is seeded.** A past day you never wrote in isn't a daily
 * waiting to be started — painting a skeleton over every empty day behind
 * you rewrites the stream's history into a wall of identical headings.
 * A day ahead is not today yet: showing the template there makes a template
 * edit look like it rewrote the future, and two devices that both open the
 * stream can each write a slightly different seed and conflict. The file
 * still appears only on the first real edit, the morning that day arrives.
 */
export function useDailyNoteSeed(date: string | null): string | undefined {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const { dateFormat, timeFormat } = settings
  const startable = date !== null && date === todayIso()
  // Read once when the row mounts, not on every render — reading the clock
  // during render is impure. A `{{time}}` in a *daily* template therefore
  // means "when this day came on screen" rather than "when you typed", which
  // is the honest reading for a note whose identity is the whole day; a
  // meeting template inserted at the cursor still resolves the live clock.
  const [mountedAt] = useState(() => new Date())

  const templatePath = dailyTemplatePath()

  const { data: template } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'daily-template', templatePath],
    // Shared across every mounted day in the stream: one read, not one per row.
    queryFn: async () => {
      try {
        return await dailyTemplateSource(templatePath)
      } catch {
        return null // no daily template — dailies open empty, as before
      }
    },
    enabled: graph !== null && startable,
  })

  if (!startable || date === null || template == null || template.trim() === '') {
    return undefined
  }
  const { templateDateFormat, templateTimeFormat } = getVaultLayout()
  return expandTemplatePlaceholders(template, {
    // A daily note's title *is* its date. The seed only runs for today, so
    // these match, but the placeholders still take the note's date so a
    // slash-inserted copy of the same template stays consistent.
    title: formatDayLabel(date, dateFormat),
    date:
      (templateDateFormat !== null ? formatIsoDate(date, templateDateFormat) : null) ??
      formatDayLabel(date, dateFormat),
    dateIso: date,
    time:
      templateTimeFormat !== null
        ? formatMoment(mountedAt, templateTimeFormat)
        : formatTimeOfDay(mountedAt, timeFormat),
    now: mountedAt,
  })
}
