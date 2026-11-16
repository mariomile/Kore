import { isAppError } from '../errors'
import { readNote } from '../graph/commands'
import { dailyPath } from '../graph/paths'
import { previewSnippet } from '../indexing/snippet'
import { parseNote } from '../markdown/extract'

/**
 * The digest the iOS daily-note widget shows (mirrors `DailyWidgetSnapshot`
 * in `plugins/tauri-plugin-recording/ios/Sources/DailyWidgetSnapshot.swift`;
 * a field change there must land here in the same review). The widget never
 * reads the vault: the app stores this digest in the App Group container
 * whenever today's note changes.
 */
export interface DailyWidgetSnapshot {
  /** The daily note's date, `YYYY-MM-DD`. */
  readonly date: string
  /** Plain-text preview of the note, possibly empty. */
  readonly preview: string
  /** Open task texts in document order, at most {@link DAILY_WIDGET_TASK_LIMIT}. */
  readonly openTasks: readonly string[]
  readonly openTaskCount: number
  readonly doneTaskCount: number
}

/** The large widget shows eight rows; nothing shows more. */
export const DAILY_WIDGET_TASK_LIMIT = 8

/** Enough for the large widget's eight preview lines. */
const DAILY_WIDGET_PREVIEW_CHARS = 320

/** A task item's marker line; the preview leaves these to the task rows. */
const TASK_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[[ x]\]/i

/** Digest one daily note's source (empty source → an empty day). */
export function dailyWidgetSnapshot(source: string, date: string): DailyWidgetSnapshot {
  const path = dailyPath(date)
  const parsed = parseNote({ path, source })
  const open = parsed.tasks.filter((task) => !task.checked && task.text.trim() !== '')
  const prose = parseNote({
    path,
    source: source
      .split('\n')
      .filter((line) => !TASK_LINE.test(line))
      .join('\n'),
  })
  return {
    date,
    preview: previewSnippet(prose.previewText, prose.title, DAILY_WIDGET_PREVIEW_CHARS),
    openTasks: open.slice(0, DAILY_WIDGET_TASK_LIMIT).map((task) => task.text.trim()),
    openTaskCount: open.length,
    doneTaskCount: parsed.tasks.filter((task) => task.checked).length,
  }
}

/** Read `date`'s daily note at `generation` and digest it; no note reads as empty. */
export async function readDailyWidgetSnapshot(
  date: string,
  generation: number,
): Promise<DailyWidgetSnapshot> {
  let source = ''
  try {
    source = await readNote(dailyPath(date), generation)
  } catch (cause) {
    if (!isAppError(cause) || cause.kind !== 'notFound') {
      throw cause
    }
  }
  return dailyWidgetSnapshot(source, date)
}
