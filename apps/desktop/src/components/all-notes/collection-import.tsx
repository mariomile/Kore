import { useRef, type ReactElement } from 'react'
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
import { Inbox } from '@/components/icons'
import { toast } from '@/components/ui/toast'
import { parseCsv, sniffCsvDelimiter } from '@/lib/csv'
import { startOperation } from '@/lib/operations'
import { invalidateOnNextIndexApply } from '@/lib/tags/use-commit-note-property'
import { useGraph } from '@/providers/graph-provider'

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
    case 'number': {
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? parsed : trimmed
    }
    case 'checkbox':
      return trimmed.toLowerCase() === 'true'
    case 'multiselect':
      return trimmed
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
    case 'relation':
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

interface CollectionImportButtonProps {
  tag: string
  type: TagType
}

/** The header's Import-CSV entry: a native file picker, then one new tagged
 * note per row through the ordinary create channel. */
export function CollectionImportButton({ tag, type }: CollectionImportButtonProps): ReactElement {
  const { graph } = useGraph()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const importFile = async (file: File): Promise<void> => {
    if (graph === null) {
      return
    }
    const operation = startOperation('Importing CSV')
    try {
      const notes = parseCollectionCsv(await file.text(), type)
      for (const note of notes) {
        const body = `# ${note.title}\n`
        const tagged = appendBodyTag(body, tag) ?? body
        const source = upsertFrontmatter(tagged, { id: newNoteId(), ...note.properties })
        await createNoteIfAbsent(untitledNotePath(), source, graph.generation)
      }
      invalidateOnNextIndexApply()
      operation.done()
      toast.add({
        type: 'info',
        title: `Imported ${notes.length} ${notes.length === 1 ? 'note' : 'notes'} into #${tag}`,
      })
    } catch (cause) {
      operation.fail(errorMessage(cause))
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined) {
            void importFile(file)
          }
        }}
      />
      <button
        type="button"
        aria-label="Import CSV into the collection"
        title="Import CSV"
        onClick={() => inputRef.current?.click()}
        className="flex size-6 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-secondary"
      >
        <Inbox aria-hidden className="size-3.5" />
      </button>
    </>
  )
}
