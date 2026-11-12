import { db } from '../indexing/db'
import { foldTag } from '../markdown'
import { isPropertyKey, type TagProperty } from '../tags/tag-type'

/**
 * The fields a converted base adds to its type (organization point 3): each
 * plain column the base showed that the type doesn't declare yet, typed from
 * the values the tag's notes already hold. The guess is conservative: a
 * field only becomes a date, number, checkbox, link or choice when every
 * stored value agrees; anything mixed stays text, which shows any value.
 */

/** One stored value of a field, as `note_properties` holds it. */
export interface StoredFieldValue {
  readonly value: string
  readonly valueType: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/
const WIKI_LINK = /^\[\[[^\]]+\]\]$/
const URL = /^https?:\/\/\S+$/
/** A choice list longer than this reads better as free text. */
const MAX_OPTIONS = 20

function listItems(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/** The field a column becomes, judged from its stored values. */
export function inferFieldFromValues(
  key: string,
  name: string,
  values: readonly StoredFieldValue[],
): TagProperty {
  const field = (type: TagProperty['type'], options?: string[]): TagProperty => ({
    name,
    key,
    type,
    ...(options === undefined ? {} : { options }),
  })
  if (values.length === 0) {
    return field('text')
  }
  const types = new Set(values.map((entry) => entry.valueType))
  if (types.size === 1 && types.has('number')) {
    return field('number')
  }
  if (types.size === 1 && types.has('boolean')) {
    return field('checkbox')
  }
  if (types.size === 1 && types.has('list')) {
    const items = values.flatMap((entry) => listItems(entry.value))
    if (items.length > 0 && items.every((item) => WIKI_LINK.test(item))) {
      return field('relations')
    }
    const distinct = [...new Set(items)]
    return distinct.length > 0 && distinct.length <= MAX_OPTIONS
      ? field(
          'multiselect',
          distinct.sort((left, right) => left.localeCompare(right)),
        )
      : field('text')
  }
  if (types.size !== 1 || !types.has('string')) {
    return field('text')
  }
  const texts = values.map((entry) => entry.value.trim())
  if (texts.every((text) => ISO_DATE.test(text))) {
    return field('date')
  }
  if (texts.every((text) => WIKI_LINK.test(text))) {
    return field('relation')
  }
  if (texts.every((text) => URL.test(text))) {
    return field('url')
  }
  const distinct = [...new Set(texts)]
  // A handful of values repeated across notes is a choice (status, stage);
  // values that are mostly unique (names, sentences) stay text.
  if (distinct.length <= MAX_OPTIONS && values.length >= distinct.length * 2) {
    return field(
      'select',
      distinct.sort((left, right) => left.localeCompare(right)),
    )
  }
  return field('text')
}

/**
 * The fields to add to `tag`'s type for these columns: every column that is
 * a valid field key and not already declared, typed from the values its
 * member notes hold. One query for all columns.
 */
export async function inferConvertedFields(
  tag: string,
  columns: readonly { readonly key: string; readonly name: string }[],
  declared: readonly TagProperty[],
): Promise<TagProperty[]> {
  const known = new Set(declared.map((property) => property.key))
  const wanted = columns.filter((column) => {
    if (!isPropertyKey(column.key) || known.has(column.key)) {
      return false
    }
    known.add(column.key)
    return true
  })
  if (wanted.length === 0) {
    return []
  }
  const rows = await db
    .selectFrom('noteProperties')
    .innerJoin('tags', 'tags.notePath', 'noteProperties.notePath')
    .where('tags.tagKey', '=', foldTag(tag))
    .where('tags.member', '=', 1)
    .where(
      'noteProperties.key',
      'in',
      wanted.map((column) => column.key),
    )
    .select(['noteProperties.key', 'noteProperties.value', 'noteProperties.valueType'])
    .execute()
  const byKey = new Map<string, StoredFieldValue[]>()
  for (const row of rows) {
    const list = byKey.get(row.key) ?? []
    list.push({ value: row.value, valueType: row.valueType })
    byKey.set(row.key, list)
  }
  return wanted.map((column) =>
    inferFieldFromValues(column.key, column.name, byKey.get(column.key) ?? []),
  )
}
