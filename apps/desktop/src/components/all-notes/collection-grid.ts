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

/**
 * The inline grid template — Subject, one column per schema property,
 * Updated. Inline style rather than a class: the columns are data-driven by
 * the tag's schema (`ALL_NOTES_GRID` stays the classic table's contract).
 */
export function collectionGridStyle(type: TagType): CSSProperties {
  const propertyColumns = type.properties.map(columnWidth).join(' ')
  return {
    gridTemplateColumns: `minmax(0, 15rem) ${propertyColumns}${
      propertyColumns === '' ? '' : ' '
    }6rem`,
  }
}
