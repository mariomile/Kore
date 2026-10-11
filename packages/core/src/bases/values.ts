import { formatBaseDate, parseBaseDate, parseBaseDuration } from './dates'

/**
 * The values Bases expressions work with, and the conversions, equality and
 * ordering rules shared by the evaluator (`evaluate.ts`), its methods
 * (`methods.ts`) and the view runner.
 */

/** One note as a base sees it. */
export interface BaseNoteRow {
  /** Graph-relative path, e.g. `Active/Projects/Kore/Kore.md`. */
  readonly path: string
  readonly title: string
  /** Last modified, epoch ms. */
  readonly mtime: number
  /**
   * Created, epoch ms. The index has no file birth time, so this is the
   * `created` (or `date`) frontmatter value when it parses, else `mtime`.
   */
  readonly ctime: number
  /** File size in bytes. */
  readonly size: number
  /** Tags without `#`, display casing (`type/project`). */
  readonly tags: readonly string[]
  /** Frontmatter values: strings, numbers, booleans and string lists. */
  readonly properties: Readonly<Record<string, BasePropertyValue>>
  /** Paths of the notes this note links to. */
  readonly links: readonly string[]
  /** Paths of the notes linking to this note. */
  readonly backlinks: readonly string[]
}

export type BasePropertyValue = string | number | boolean | readonly string[] | null

export interface BaseDate {
  readonly kind: 'date'
  readonly ms: number
  /** False for a calendar day (`today()`, `date("2026-10-10")`). */
  readonly time: boolean
}
export interface BaseDuration {
  readonly kind: 'duration'
  readonly ms: number
}
export interface BaseList {
  readonly kind: 'list'
  readonly items: readonly BaseValue[]
}
/** A link to a note; `path` is null when it resolves to nothing. */
export interface BaseLink {
  readonly kind: 'link'
  readonly path: string | null
  readonly text: string
}
export interface BaseFile {
  readonly kind: 'file'
  readonly row: BaseNoteRow
}
/** Output of `html()`: shown as its text, never injected as markup. */
export interface BaseHtml {
  readonly kind: 'html'
  readonly html: string
}
interface BaseNamespace {
  readonly kind: 'namespace'
  readonly name: 'note' | 'formula'
}

export type BaseValue =
  | null
  | string
  | number
  | boolean
  | BaseDate
  | BaseDuration
  | BaseList
  | BaseLink
  | BaseFile
  | BaseHtml
  | BaseNamespace

/** What an evaluation can see besides the row. */
export interface BaseEvaluationContext {
  readonly row: BaseNoteRow
  /** Evaluation time, epoch ms: one value for a whole view. */
  readonly now: number
  /** The base's `formulas:` section, by name. */
  readonly formulas: Readonly<Record<string, string>>
  /** Display title of a note path (for links). */
  readonly titleOf: (path: string) => string
  /** Resolve a link target (`"Kore"`, `"Active/Kore.md"`) to a note path. */
  readonly resolve: (target: string) => string | null
}

export class BaseEvaluationError extends Error {}

export function fail(message: string): never {
  throw new BaseEvaluationError(message)
}

export const DAY_MS = 86_400_000

/** Obsidian truthiness: null, false, 0, `""` and empty lists are false. */
export function isTruthy(value: BaseValue): boolean {
  if (value === null || value === false || value === 0 || value === '') {
    return false
  }
  if (typeof value === 'object' && value.kind === 'list') {
    return value.items.length > 0
  }
  if (typeof value === 'object' && value.kind === 'duration') {
    return value.ms !== 0
  }
  return true
}

/** A value as display text. */
export function baseValueText(value: BaseValue): string {
  if (value === null) {
    return ''
  }
  switch (typeof value) {
    case 'string':
      return value
    case 'number':
      return Number.isSafeInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
    case 'boolean':
      return value ? 'true' : 'false'
  }
  switch (value.kind) {
    case 'date':
      return formatBaseDate(value.ms, value.time ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD')
    case 'duration':
      return `${baseValueText(value.ms / DAY_MS)} days`
    case 'list':
      return value.items.map(baseValueText).join(', ')
    case 'link':
      return value.text
    case 'file':
      return value.row.title
    case 'html':
      return htmlText(value.html)
    case 'namespace':
      return ''
  }
}

/** Visible text of an `html()` value: tags dropped, common entities decoded. */
export function htmlText(html: string): string {
  return html
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .trim()
}

export function fromProperty(value: BasePropertyValue | undefined): BaseValue {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value === 'object') {
    return { kind: 'list', items: [...value] }
  }
  return value
}

export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function basenameOf(path: string): string {
  return fileNameOf(path).replace(/\.md$/i, '')
}

function stripHash(tag: string): string {
  return tag.replace(/^#/, '').toLowerCase()
}

/** `hasTag("a")` matches `a` and its nested children (`a/b`). */
export function rowHasTag(row: BaseNoteRow, wanted: string): boolean {
  const key = stripHash(wanted)
  return row.tags.some((tag) => {
    const folded = stripHash(tag)
    return folded === key || folded.startsWith(`${key}/`)
  })
}

/** `inFolder("A/B")` holds for notes in `A/B` and its subfolders. */
export function rowInFolder(row: BaseNoteRow, folder: string): boolean {
  const wanted = folder.replaceAll(/^\/+|\/+$/g, '')
  if (wanted === '') {
    return true
  }
  const own = folderOf(row.path)
  return own === wanted || own.startsWith(`${wanted}/`)
}

export function asText(value: BaseValue): string {
  return baseValueText(value)
}

export function asNumber(value: BaseValue, where: string): number {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  return fail(`${where} needs a number`)
}

export function asDate(value: BaseValue): BaseDate | null {
  if (value === null) {
    return null
  }
  if (typeof value === 'object' && value.kind === 'date') {
    return value
  }
  if (typeof value === 'number') {
    return { kind: 'date', ms: value, time: true }
  }
  if (typeof value === 'string') {
    return parseBaseDate(value)
  }
  return null
}

export function asDuration(value: BaseValue): BaseDuration | null {
  if (typeof value === 'object' && value !== null && value.kind === 'duration') {
    return value
  }
  if (typeof value === 'string') {
    const ms = parseBaseDuration(value)
    return ms === null ? null : { kind: 'duration', ms }
  }
  return null
}

export function isKind<K extends string>(
  value: BaseValue,
  kind: K,
): value is Extract<BaseValue, { kind: K }> {
  return typeof value === 'object' && value !== null && value.kind === kind
}

/** Loose equality: `null` equals `""`, links equal their text or path. */
export function baseValuesEqual(left: BaseValue, right: BaseValue): boolean {
  const leftEmpty = left === null || left === ''
  const rightEmpty = right === null || right === ''
  if (leftEmpty || rightEmpty) {
    return leftEmpty && rightEmpty
  }
  if (isKind(left, 'date') || isKind(right, 'date')) {
    const leftDate = asDate(left)
    const rightDate = asDate(right)
    return leftDate !== null && rightDate !== null && leftDate.ms === rightDate.ms
  }
  if (isKind(left, 'list') && isKind(right, 'list')) {
    return (
      left.items.length === right.items.length &&
      left.items.every((item, index) => baseValuesEqual(item, right.items[index] ?? null))
    )
  }
  if (
    isKind(left, 'link') ||
    isKind(right, 'link') ||
    isKind(left, 'file') ||
    isKind(right, 'file')
  ) {
    return linkKey(left) === linkKey(right)
  }
  if (typeof left === 'number' || typeof right === 'number') {
    return typeof left === typeof right ? left === right : asText(left) === asText(right)
  }
  return asText(left) === asText(right)
}

function linkKey(value: BaseValue): string {
  if (isKind(value, 'link')) {
    return (value.path === null ? value.text : basenameOf(value.path)).toLowerCase()
  }
  if (isKind(value, 'file')) {
    return basenameOf(value.row.path).toLowerCase()
  }
  return asText(value)
    .replaceAll(/^\[\[|\]\]$/g, '')
    .split('|')[0]!
    .toLowerCase()
}

/** Ordering for comparisons and sorts; null when the kinds don't compare. */
export function compareBaseValues(left: BaseValue, right: BaseValue): number | null {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }
  if (isKind(left, 'duration') && isKind(right, 'duration')) {
    return left.ms - right.ms
  }
  if (isKind(left, 'date') || isKind(right, 'date')) {
    const leftDate = asDate(left)
    const rightDate = asDate(right)
    return leftDate === null || rightDate === null ? null : leftDate.ms - rightDate.ms
  }
  if (typeof left === 'number' || typeof right === 'number') {
    const leftNumber = typeof left === 'number' ? left : Number(asText(left))
    const rightNumber = typeof right === 'number' ? right : Number(asText(right))
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : null
  }
  if (left === null || right === null) {
    return null
  }
  return asText(left).localeCompare(asText(right), undefined, { numeric: true })
}
