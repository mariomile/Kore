import type { CollectionEntry, TagType } from '@reflect/core'
import { exportFileName, runFileExport } from '@/lib/export-file'
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

/** The export behind the collection header's CSV button. */
export async function runCollectionExport(
  tag: string,
  type: TagType,
  entries: readonly CollectionEntry[],
): Promise<void> {
  await runFileExport({
    operation: 'Exporting collection',
    defaultPath: exportFileName(tag, 'collection', 'csv'),
    filter: { name: 'CSV', extensions: ['csv'] },
    build: () => collectionCsv(type, entries),
  })
}
