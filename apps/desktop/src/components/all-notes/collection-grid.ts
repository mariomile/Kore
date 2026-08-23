import type { CSSProperties } from 'react'
import type { TagProperty, TagType } from '@reflect/core'

/**
 * The Collection table's shared column layout, in its own module so the
 * header (collection-table) and the rows (collection-row) depend on it in
 * one direction — neither on the other.
 */

/** Shared non-column layout classes for the header and every row. */
export const COLLECTION_GRID_CLASS = 'grid items-center gap-4 pl-12 pr-7'

/** Column width per property type — narrow for glyph/numeric columns. */
function columnWidth(property: TagProperty): string {
  switch (property.type) {
    case 'checkbox':
      return '4rem'
    case 'number':
      return 'minmax(4rem, 6rem)'
    case 'date':
      return 'minmax(6rem, 7rem)'
    default:
      return 'minmax(6rem, 1fr)'
  }
}

/** The rem a column can never shrink below (the minmax lower bounds). */
function columnMinRem(property: TagProperty): number {
  return property.type === 'checkbox' || property.type === 'number' ? 4 : 6
}

/**
 * The inline grid template — Subject, one column per schema property,
 * Updated. Inline style rather than a class: the columns are data-driven by
 * the tag's schema (`ALL_NOTES_GRID` stays the classic table's contract).
 *
 * `minWidth` is the template's own floor (column minimums + gaps + the
 * row padding): with many columns the header and every row keep the same
 * width and the screen's scroll container scrolls them horizontally,
 * instead of the grid crushing its columns past readability. The page body
 * never scrolls sideways — only the notes container does.
 */
export function collectionGridStyle(type: TagType): CSSProperties {
  const propertyColumns = type.properties.map(columnWidth).join(' ')
  const columns = type.properties.length + 2
  const minRem =
    8 + // subject floor
    type.properties.reduce((total, property) => total + columnMinRem(property), 0) +
    6 + // updated
    (columns - 1) * 1 + // gap-4
    3 + // pl-12
    1.75 // pr-7
  return {
    gridTemplateColumns: `minmax(8rem, 15rem) ${propertyColumns}${
      propertyColumns === '' ? '' : ' '
    }6rem`,
    minWidth: `${minRem}rem`,
  }
}
