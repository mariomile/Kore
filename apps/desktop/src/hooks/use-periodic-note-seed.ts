import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  DEFAULT_VAULT_LAYOUT,
  WEEKLY_TEMPLATE,
  expandTemplatePlaceholders,
  formatIsoDate,
  formatMoment,
  getVaultLayout,
  isDaily,
  readNote,
  weekFromWeeklyPath,
  weeklyNoteTitle,
  type IsoWeek,
} from '@kore/core'
import { formatDayLabel, formatTimeOfDay, todayIso } from '@/lib/dates'
import { templateBody } from '@/lib/note-templates'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

/**
 * Seeds for periodic notes: a missing daily or weekly note opens on its
 * template (`templates/daily.md`, `templates/weekly.md`) without writing
 * anything until the user edits.
 */

/**
 * Where a daily note's starting shape lives: `templates/daily.md` by
 * convention, or the template an adopted Obsidian vault names.
 */
export function dailyTemplatePath(): string {
  return getVaultLayout().dailyTemplate
}

/** The template a periodic note's seed comes from, or `null` for any other note. */
export function seedTemplatePathFor(path: string): string | null {
  if (isDaily(path)) {
    return dailyTemplatePath()
  }
  return weekFromWeeklyPath(path) !== null ? WEEKLY_TEMPLATE : null
}

/**
 * The template's markdown as a periodic note starts from it. Kore's own
 * templates drop their frontmatter (metadata, never content), exactly as an
 * inserted template does; a vault's Obsidian daily template is copied whole,
 * the way Obsidian copies it, so its `tags:` and properties reach the new
 * daily.
 */
async function templateSource(path: string): Promise<string> {
  return path === DEFAULT_VAULT_LAYOUT.dailyTemplate || path === WEEKLY_TEMPLATE
    ? await templateBody(path)
    : await readNote(path)
}

/**
 * Where Keep should write when the open note is showing conflict markers.
 * A missing periodic note's markers came from its template (the seed);
 * writing the note's own path would create that day's or week's file and
 * leave the template conflicted for every later one.
 */
export function conflictWritePath(path: string, options: { readonly missing: boolean }): string {
  return options.missing ? (seedTemplatePathFor(path) ?? path) : path
}

/** What a template's placeholders expand against. */
interface SeedTarget {
  /** `{{title}}`: the note's display title (`Tue, Aug 22nd, 2026`, `Week 47`). */
  readonly title: string
  /** `{{date}}`: the ISO date the note belongs to (a week's Monday). */
  readonly dateIso: string
}

/**
 * A template's expanded markdown for `target`, or undefined when there is
 * no target (not startable), no template, or an empty one. The template is
 * read once per graph and path and shared by every mounted note.
 */
function useTemplateSeed(templatePath: string, target: SeedTarget | null): string | undefined {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const { dateFormat, timeFormat } = settings
  // Read once when the note mounts, not on every render — reading the clock
  // during render is impure. A `{{time}}` in a periodic template therefore
  // means "when this note came on screen" rather than "when you typed", the
  // honest reading for a note whose identity is a whole day or week; a
  // meeting template inserted at the cursor still resolves the live clock.
  const [mountedAt] = useState(() => new Date())

  const { data: template } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'periodic-template', templatePath],
    queryFn: async () => {
      try {
        return await templateSource(templatePath)
      } catch {
        return null // no template: the note opens empty
      }
    },
    enabled: graph !== null && target !== null,
  })

  if (target === null || template == null || template.trim() === '') {
    return undefined
  }
  const { templateDateFormat, templateTimeFormat } = getVaultLayout()
  return expandTemplatePlaceholders(template, {
    title: target.title,
    date:
      (templateDateFormat !== null ? formatIsoDate(target.dateIso, templateDateFormat) : null) ??
      formatDayLabel(target.dateIso, dateFormat),
    dateIso: target.dateIso,
    time:
      templateTimeFormat !== null
        ? formatMoment(mountedAt, templateTimeFormat)
        : formatTimeOfDay(mountedAt, timeFormat),
    now: mountedAt,
  })
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
  const { settings } = useSettings()
  const startable = date !== null && date === todayIso()
  // A daily note's title *is* its date. The seed only runs for today, but
  // the placeholders still take the note's date so a slash-inserted copy of
  // the same template stays consistent.
  return useTemplateSeed(
    dailyTemplatePath(),
    startable ? { title: formatDayLabel(date, settings.dateFormat), dateIso: date } : null,
  )
}

/**
 * The markdown a weekly note starts life with: `templates/weekly.md`
 * expanded for the week (`{{title}}` is `Week 47`, `{{date}}` its Monday),
 * under the daily seed's lazy contract. Every week is startable: a week
 * page is opened deliberately, one at a time, never painted in a stream.
 */
export function useWeeklyNoteSeed(week: IsoWeek | null): string | undefined {
  return useTemplateSeed(
    WEEKLY_TEMPLATE,
    week === null ? null : { title: weeklyNoteTitle(week), dateIso: week.start },
  )
}
