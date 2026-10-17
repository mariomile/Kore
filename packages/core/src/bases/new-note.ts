import { createNoteWithSource, newNoteSource } from '../graph/create-note'
import { upsertFrontmatter } from '../markdown/frontmatter'
import { addNoteTag } from '../markdown/note-tag'
import type { BaseFilter } from './base-file'
import { baseEditableKey, type BaseGroupDropValue } from './edit'
import { parseBaseExpression, type BaseExpression } from './expression'

/**
 * Adding a note from a base, as Notion adds a row to a database: the note
 * starts with what the view's filters require of it, so it lands in the
 * view it was created from. Only conditions every matching note must meet
 * are read: an `and` chain of `prop == value`, `file.hasTag(…)`,
 * `file.tags.contains(…)`, `file.inFolder(…)` and `file.folder == …`.
 * Anything under `or` / `not`, or any other expression, prefills nothing.
 * The `.base` file is never written.
 */

/** What a note created from a view starts with. */
export interface BaseNewNotePrefill {
  /** Graph-relative folder (`''` is the vault root); null keeps the vault's new-note folder. */
  readonly folder: string | null
  /** Frontmatter values the view's equality filters (and a lane) imply. */
  readonly properties: Readonly<Record<string, string | number | boolean>>
  /** Tags the view's filters require, without `#`. */
  readonly tags: readonly string[]
}

interface PrefillDraft {
  folder: string | null
  properties: Record<string, string | number | boolean>
  tags: string[]
}

type Literal = string | number | boolean

function literal(expression: BaseExpression): Literal | null {
  return expression.type === 'literal' && expression.value !== null ? expression.value : null
}

/** The property id a reference names: `status`, `note.status`, `note["status"]`, `file.folder`. */
function propertyId(expression: BaseExpression): string | null {
  if (expression.type === 'identifier') {
    return expression.name
  }
  if (expression.type === 'member' && expression.object.type === 'identifier') {
    return `${expression.object.name}.${expression.name}`
  }
  if (
    expression.type === 'index' &&
    expression.object.type === 'identifier' &&
    expression.object.name === 'note' &&
    expression.index.type === 'literal' &&
    typeof expression.index.value === 'string'
  ) {
    return `note.${expression.index.value}`
  }
  return null
}

function cleanFolder(folder: string): string {
  return folder.trim().replaceAll(/^\/+|\/+$/g, '')
}

function cleanTag(tag: string): string {
  return tag.trim().replace(/^#/, '')
}

function addEquality(draft: PrefillDraft, id: string, value: Literal): void {
  if (id === 'file.folder') {
    if (typeof value === 'string' && draft.folder === null) {
      draft.folder = cleanFolder(value)
    }
    return
  }
  const key = baseEditableKey(id)
  if (key !== null && !(key in draft.properties)) {
    draft.properties[key] = value
  }
}

function addCall(draft: PrefillDraft, expression: Extract<BaseExpression, { type: 'call' }>): void {
  const { callee } = expression
  const first = expression.args[0]
  const argument = first === undefined ? null : literal(first)
  if (callee.type !== 'member' || typeof argument !== 'string') {
    return
  }
  const target = propertyId(callee.object)
  // `hasTag(a, b)` matches either tag, so only the first is a sure bet.
  const tag =
    (target === 'file' && callee.name === 'hasTag') ||
    (target === 'file.tags' && callee.name === 'contains')
      ? cleanTag(argument)
      : null
  if (tag !== null && tag !== '' && !draft.tags.includes(tag)) {
    draft.tags.push(tag)
  } else if (target === 'file' && callee.name === 'inFolder' && draft.folder === null) {
    draft.folder = cleanFolder(argument)
  }
}

function walk(draft: PrefillDraft, expression: BaseExpression): void {
  if (expression.type === 'call') {
    addCall(draft, expression)
    return
  }
  if (expression.type !== 'binary') {
    return
  }
  if (expression.operator === '&&') {
    walk(draft, expression.left)
    walk(draft, expression.right)
    return
  }
  if (expression.operator !== '==') {
    return
  }
  const pairs: [BaseExpression, BaseExpression][] = [
    [expression.left, expression.right],
    [expression.right, expression.left],
  ]
  for (const [reference, value] of pairs) {
    const id = propertyId(reference)
    const constant = literal(value)
    if (id !== null && constant !== null) {
      addEquality(draft, id, constant)
      return
    }
  }
}

function collect(draft: PrefillDraft, filter: BaseFilter | null): void {
  if (filter === null) {
    return
  }
  if (filter.kind === 'and') {
    for (const item of filter.items) {
      collect(draft, item)
    }
    return
  }
  if (filter.kind === 'expression') {
    try {
      walk(draft, parseBaseExpression(filter.source))
    } catch {
      // An expression Kore can't parse already matches nothing; it implies nothing either.
    }
  }
}

/** The prefill a view's global and view filters imply (both must hold). */
export function baseNewNotePrefill(filters: readonly (BaseFilter | null)[]): BaseNewNotePrefill {
  const draft: PrefillDraft = { folder: null, properties: {}, tags: [] }
  for (const filter of filters) {
    collect(draft, filter)
  }
  return draft
}

/**
 * The prefill for a note created in one lane (or grouped section): the
 * view's prefill plus the lane's own value, which wins over a filter on the
 * same key. A lane that takes no drops, or the empty lane, adds nothing.
 */
export function baseNewNotePrefillForGroup(
  prefill: BaseNewNotePrefill,
  groupEditKey: string | null,
  dropValue: BaseGroupDropValue | undefined,
): BaseNewNotePrefill {
  if (groupEditKey === null || dropValue === undefined || dropValue === null) {
    return prefill
  }
  return {
    ...prefill,
    properties: { ...prefill.properties, [groupEditKey]: dropValue },
  }
}

/** The on-disk source of a new note titled `title` with `prefill` applied. */
export function baseNewNoteSource(title: string, prefill: BaseNewNotePrefill): string {
  const titled = upsertFrontmatter(newNoteSource(title), prefill.properties)
  return prefill.tags.reduce((source, tag) => addNoteTag(source, tag) ?? source, titled)
}

/**
 * Create a note titled `title` from a base view, in the prefill's folder (or
 * the vault's new-note folder) and named as the vault names new notes.
 * Returns the new graph-relative path.
 */
export async function createBaseNote(
  title: string,
  prefill: BaseNewNotePrefill,
  generation: number,
): Promise<string> {
  return await createNoteWithSource(
    title,
    baseNewNoteSource(title, prefill),
    generation,
    prefill.folder,
  )
}
