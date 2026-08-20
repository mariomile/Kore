/**
 * A small RFC 4180 CSV reader for the attachment viewer: quoted fields,
 * doubled-quote escapes, newlines inside quotes, and delimiter sniffing
 * (comma / semicolon / tab — European exports lean on semicolons, `.tsv` on
 * tabs). Parsing stays forgiving — a malformed file renders as best it can
 * rather than erroring — because the viewer's job is showing the file, not
 * validating it.
 */

const DELIMITERS = [',', ';', '\t'] as const

/** The delimiter that splits the first record into the most fields. */
export function sniffCsvDelimiter(text: string): string {
  let best: string = DELIMITERS[0]
  let bestCount = -1
  for (const delimiter of DELIMITERS) {
    const count = parseCsv(headRecord(text), delimiter)[0]?.length ?? 0
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

/** The first record, quote-aware (a quoted field may span newlines). */
function headRecord(text: string): string {
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      quoted = !quoted
    } else if ((char === '\n' || char === '\r') && !quoted) {
      return text.slice(0, index)
    }
  }
  return text
}

/** Parse `text` into rows of fields; sniffs the delimiter when not given. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const sep = delimiter ?? sniffCsvDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const endField = (): void => {
    row.push(field)
    field = ''
  }
  const endRow = (): void => {
    endField()
    rows.push(row)
    row = []
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"' && field === '') {
      quoted = true
    } else if (char === sep) {
      endField()
    } else if (char === '\n') {
      endRow()
    } else if (char === '\r') {
      if (text[index + 1] === '\n') {
        index += 1
      }
      endRow()
    } else {
      field += char
    }
  }
  // A trailing newline is a record end already handled; anything else is the
  // final field of the final row.
  if (field !== '' || row.length > 0) {
    endRow()
  }
  return rows
}
