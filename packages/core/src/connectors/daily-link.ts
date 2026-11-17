import { isAppError } from '../errors'
import { readNote, writeNote } from '../graph/commands'
import { dailyPath } from '../graph/paths'
import { appendListItemUnderHeading, wikiLinkSafe } from '../markdown/edit'
import { foldKey } from '../markdown/keys'

/**
 * "Link new notes in the daily note": each note a connector creates gets one
 * line under a heading of that day's daily note, the way the Obsidian
 * plugins do it, so the day reads as a log of what came in:
 *
 *     ## Meetings
 *     - 09:32 [[Granola/2026-11-16 Standup|Standup]]
 *
 * The link carries the note's path (unambiguous whatever its title) and the
 * title as its alias. A daily note that already links the note is left
 * alone, so a re-run, another device, or the plugin that wrote the line
 * before never doubles it.
 */

/** One note to link: where it lives, what to call it, and its day. */
export interface DailyLinkEntry {
  /** Graph-relative path of the connector note (with `.md`). */
  readonly path: string
  readonly title: string
  /** `YYYY-MM-DD`. */
  readonly date: string
  /** Local `HH:MM`, or `null` when the source has no time. */
  readonly time: string | null
}

const WIKI_TARGET_RE = /\[\[([^[\]|\r\n]+)(?:\|[^[\]\r\n]*)?\]\]/g

function linkTarget(path: string): string {
  return path.replace(/\.md$/i, '')
}

function linkedTargets(source: string): Set<string> {
  return new Set(
    Array.from(source.matchAll(WIKI_TARGET_RE), (match) =>
      foldKey(linkTarget((match[1] ?? '').split('#')[0]!.trim())),
    ),
  )
}

/** The list line for `entry`, without the bullet. */
export function dailyLinkLine(entry: DailyLinkEntry): string {
  const title = wikiLinkSafe(entry.title) || linkTarget(entry.path).split('/').pop() || 'Untitled'
  const link = `[[${linkTarget(entry.path)}|${title}]]`
  return entry.time === null ? link : `${entry.time} ${link}`
}

/**
 * `source` with a line for every entry it does not link yet, under
 * `heading` (created as an H2 at the end when missing), in time order.
 * Returns `source` unchanged when there is nothing to add.
 */
export function withDailyLinks(
  source: string,
  heading: string,
  entries: readonly DailyLinkEntry[],
): string {
  const known = linkedTargets(source)
  const fresh = entries
    .filter((entry) => !known.has(foldKey(linkTarget(entry.path))))
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  let next = source
  for (const entry of fresh) {
    next = appendListItemUnderHeading(next, heading, dailyLinkLine(entry))
  }
  return next
}

async function readOrEmpty(path: string, generation: number): Promise<string> {
  try {
    return await readNote(path, generation)
  } catch (cause) {
    if (isAppError(cause) && cause.kind === 'notFound') {
      return ''
    }
    throw cause
  }
}

/** Write `entries` into their daily notes, one write per day. */
export async function linkInDailyNotes(
  entries: readonly DailyLinkEntry[],
  heading: string,
  generation: number,
): Promise<void> {
  const byDate = new Map<string, DailyLinkEntry[]>()
  for (const entry of entries) {
    byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry])
  }
  for (const [date, dayEntries] of byDate) {
    const path = dailyPath(date)
    const source = await readOrEmpty(path, generation)
    const next = withDailyLinks(source, heading, dayEntries)
    if (next !== source) {
      await writeNote(path, next, generation)
    }
  }
}
