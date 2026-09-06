import {
  appendBodyTag,
  createNoteIfAbsent,
  errorMessage,
  newNoteId,
  relationValue,
  untitledNotePath,
  upsertFrontmatter,
  type TagProperty,
  type TagType,
} from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { parseCsv, sniffCsvDelimiter } from '@/lib/csv'
import { startOperation } from '@/lib/operations'
import { invalidateOnNextIndexApply } from '@/lib/tags/use-commit-note-property'

/**
 * CSV → collection (TDR 0005): the export's inverse. Columns match schema
 * properties by name or key (case-insensitive); a Title column (or the first
 * column) names each note; Path is ignored. Every row becomes a NEW tagged
 * note with the matched values in frontmatter — import never updates or
 * overwrites existing notes, so a re-import duplicates rather than clobbers.
 */

/** One parsed row, ready to become a note. */
export interface CsvNote {
  title: string
  properties: Record<string, unknown>
}

/** A property's typed YAML value from one CSV cell ('' means unset). */
function cellValue(property: TagProperty, raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return undefined
  }
  switch (property.type) {
    case 'number':
    case 'rating': {
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? parsed : trimmed
    }
    case 'checkbox':
      return trimmed.toLowerCase() === 'true'
    case 'files':
    case 'multiselect':
      return trimmed
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
    case 'relation':
    case 'person':
      return relationValue(trimmed)
    case 'relations':
      return trimmed
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
        .map(relationValue)
    default:
      return trimmed
  }
}

/** Parse a CSV into notes-to-create against the tag's schema. */
export function parseCollectionCsv(text: string, type: TagType): CsvNote[] {
  const rows = parseCsv(text, sniffCsvDelimiter(text))
  const [header, ...records] = rows
  if (header === undefined) {
    return []
  }
  const normalized = header.map((column) => column.trim().toLowerCase())
  const titleIndex = Math.max(normalized.indexOf('title'), 0)
  const columns = new Map<number, TagProperty>()
  for (const property of type.properties) {
    // View-only columns (and the mtime-backed stamp) never import — their
    // values are computed, not stored. `created` does: a CSV's historical
    // date is exactly the value the stamp must not overwrite.
    if (
      property.type === 'rollup' ||
      property.type === 'reverse' ||
      property.type === 'updated' ||
      property.type === 'formula'
    ) {
      continue
    }
    const index = normalized.findIndex(
      (column) => column === property.name.toLowerCase() || column === property.key.toLowerCase(),
    )
    if (index >= 0 && index !== titleIndex) {
      columns.set(index, property)
    }
  }
  const notes: CsvNote[] = []
  for (const record of records) {
    if (record.every((cell) => cell.trim() === '')) {
      continue
    }
    const title = (record[titleIndex] ?? '').trim()
    const properties: Record<string, unknown> = {}
    for (const [index, property] of columns) {
      const value = cellValue(property, record[index] ?? '')
      if (value !== undefined) {
        properties[property.key] = value
      }
    }
    notes.push({ title: title === '' ? 'Untitled' : title, properties })
  }
  return notes
}

/** Create one tagged note per CSV row through the ordinary create channel. */
export async function importCollectionCsv(
  tag: string,
  type: TagType,
  generation: number,
  text: string,
): Promise<number> {
  const notes = parseCollectionCsv(text, type)
  for (const note of notes) {
    const body = `# ${note.title}\n`
    const tagged = appendBodyTag(body, tag) ?? body
    const source = upsertFrontmatter(tagged, { id: newNoteId(), ...note.properties })
    await createNoteIfAbsent(untitledNotePath(), source, generation)
  }
  invalidateOnNextIndexApply()
  return notes.length
}

/** Run {@link importCollectionCsv} behind the operations line and a toast. */
export async function importCollectionCsvFile(
  tag: string,
  type: TagType,
  generation: number,
  file: File,
): Promise<void> {
  const operation = startOperation('Importing CSV')
  try {
    const count = await importCollectionCsv(tag, type, generation, await file.text())
    operation.done()
    toast.add({
      type: 'info',
      title: `Imported ${count} ${count === 1 ? 'note' : 'notes'} into #${tag}`,
    })
  } catch (cause) {
    operation.fail(errorMessage(cause))
  }
}
