import { errorMessage, exportHtmlWrite, type CollectionEntry, type TagType } from '@reflect/core'
import { save } from '@tauri-apps/plugin-dialog'
import { startOperation } from '@/lib/operations'
import { readCellValue } from './collection-cell'

/**
 * Collection → CSV (TDR 0005): the table view's rows as a spreadsheet-ready
 * file. Cells are the same display readings the table shows (relations by
 * their titles, checkboxes as true/false, dates in their honest ISO form);
 * the file goes where the OS save dialog pointed, through the same export
 * write channel as the styled note export.
 */

/** RFC 4180 quoting: wrap when the text carries a comma, quote, or newline. */
function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** One cell's CSV text under `property`'s type ('' for an absent value). */
function csvCellText(
  property: TagType['properties'][number],
  value: CollectionEntry['properties'][string] | undefined,
): string {
  if (value === undefined) {
    return ''
  }
  const reading = readCellValue(property, value)
  if (property.type === 'checkbox' && !reading.mismatch) {
    return reading.checked ? 'true' : 'false'
  }
  return reading.text
}

/** The whole collection as CSV text: Title, one column per property, Path. */
export function collectionCsv(type: TagType, entries: readonly CollectionEntry[]): string {
  const header = ['Title', ...type.properties.map((property) => property.name), 'Path']
  const lines = [header.map(csvField).join(',')]
  for (const entry of entries) {
    const cells = [
      entry.title,
      ...type.properties.map((property) => csvCellText(property, entry.properties[property.key])),
      entry.path,
    ]
    lines.push(cells.map(csvField).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

/** A save-dialog default the OS accepts: the tag with path characters out. */
function suggestedFileName(tag: string): string {
  const safe = tag.replaceAll(/[\\/:]/g, '-').trim()
  return `${safe === '' ? 'collection' : safe}.csv`
}

/**
 * The export flow behind the collection header's CSV button: ask where to
 * save, build, write. Cancelling the dialog is a silent no-op; failures land
 * on the operations status line like other background work.
 */
export async function runCollectionExport(
  tag: string,
  type: TagType,
  entries: readonly CollectionEntry[],
): Promise<void> {
  let target: string | null = null
  try {
    target = await save({
      defaultPath: suggestedFileName(tag),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
  } catch (cause) {
    startOperation('Exporting collection').fail(errorMessage(cause))
    return
  }
  if (target === null) {
    return
  }
  const operation = startOperation('Exporting collection')
  try {
    await exportHtmlWrite(target, collectionCsv(type, entries))
    operation.done()
  } catch (cause) {
    operation.fail(errorMessage(cause))
  }
}
