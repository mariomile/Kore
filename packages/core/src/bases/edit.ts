import { RESERVED_FRONTMATTER_KEYS } from '../tags/tag-type'
import type { BasePropertyValue } from './values'

/**
 * Editing a base's cells. A base is a query over notes, so an edit never
 * touches the `.base` file: it writes the note's own frontmatter, the same
 * value Obsidian reads back. Only plain note properties are editable;
 * `file.*` fields and formulas are computed, and wikilink values stay
 * read-only so an inline text box can never mangle a link.
 */

/** How a cell edits: the editor to show and the value it starts from. */
export type BaseCellEdit =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'list'; readonly value: readonly string[] }

/** A value a group's lane writes when a card is dropped on it; null clears. */
export type BaseGroupDropValue = string | number | boolean | null

/**
 * The frontmatter key a column writes, or null for a computed column
 * (`file.*`, `formula.*`, `this.*`) or a key Kore reserves for itself.
 */
export function baseEditableKey(columnId: string): string | null {
  if (/^(?:file|formula|this)\./.test(columnId)) {
    return null
  }
  const key = columnId.startsWith('note.') ? columnId.slice('note.'.length) : columnId
  if (key.trim() === '' || key.includes('.') || RESERVED_FRONTMATTER_KEYS.has(key)) {
    return null
  }
  return key
}

function holdsLink(text: string): boolean {
  return text.includes('[[') || /\]\(.+\)/.test(text)
}

/**
 * The editor for a property's current value, or null when it must stay
 * read-only (a wikilink, or a list holding one). A missing value edits as
 * empty text.
 */
export function baseCellEdit(value: BasePropertyValue | undefined): BaseCellEdit | null {
  if (value === undefined || value === null) {
    return { kind: 'text', value: '' }
  }
  if (typeof value === 'boolean') {
    return { kind: 'boolean', value }
  }
  if (typeof value === 'number') {
    return { kind: 'number', value }
  }
  if (typeof value === 'string') {
    return holdsLink(value) ? null : { kind: 'text', value }
  }
  return value.some(holdsLink) ? null : { kind: 'list', value: [...value] }
}

/** The text an editor shows for `edit`. Lists join with `, `. */
export function baseCellEditText(edit: BaseCellEdit): string {
  switch (edit.kind) {
    case 'text':
      return edit.value
    case 'number':
      return String(edit.value)
    case 'boolean':
      return edit.value ? 'true' : 'false'
    case 'list':
      return edit.value.join(', ')
  }
}

/**
 * Turn what the user typed back into the value to write, keeping the cell's
 * type: a number stays a number, a list splits on commas. Empty input
 * clears the key (`undefined`). A number cell holding text that is not a
 * number keeps the text rather than losing it.
 */
export function parseBaseCellInput(
  edit: BaseCellEdit,
  input: string,
): string | number | boolean | string[] | undefined {
  const text = input.trim()
  switch (edit.kind) {
    case 'boolean':
      return text === 'true'
    case 'number': {
      if (text === '') {
        return undefined
      }
      const number = Number(text)
      return Number.isFinite(number) ? number : text
    }
    case 'list': {
      const items = text
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '')
      return items.length === 0 ? undefined : items
    }
    case 'text':
      return text === '' ? undefined : text
  }
}

/**
 * What dropping a card on a lane writes: the lane's own frontmatter value,
 * read from a note already in it. Lanes grouped by a list or a link value
 * are not drop targets (`undefined`); the empty lane clears the key (null).
 */
export function baseGroupDropValue(
  value: BasePropertyValue | undefined,
): BaseGroupDropValue | undefined {
  if (value === undefined || value === null || value === '') {
    return null
  }
  if (typeof value === 'object') {
    return undefined
  }
  if (typeof value === 'string' && holdsLink(value)) {
    return undefined
  }
  return value
}
