import type { CSSProperties } from 'react'
import { TITLE_SORT_KEY, type TagProperty, type TagType, type UiDensity } from '@kore/core'

/**
 * The Collection table's shared column layout, in its own module so the
 * header (collection-table) and the rows (collection-row) depend on it in
 * one direction — neither on the other.
 */

/** Shared non-column layout classes for the header, rows, and footer. */
export const COLLECTION_GRID_CLASS = 'grid items-stretch'

/**
 * Notion-grade compact row heights for database tables, synced between the
 * virtualizer (`itemSize`) and every row's inline `height`.
 */
export const COLLECTION_ROW_HEIGHT: Record<UiDensity, number> = {
  compact: 34,
  default: 38,
  comfortable: 44,
}

/** Natural column width (rem) for the Title column (excluding the left gutter). */
export function defaultTitleRem(embedded: boolean): number {
  return embedded ? 13.5 : 17
}

/** Natural column width (rem) per property type. */
export function defaultColumnRem(property: TagProperty): number {
  switch (property.type) {
    case 'checkbox':
      return 4.5
    case 'number':
    case 'rating':
      return 6.5
    case 'date':
    case 'created':
    case 'updated':
      return 8.5
    case 'select':
    case 'status':
      return 9
    case 'person':
      return 10
    default:
      return 11.5
  }
}

/** Width (rem) of the left selection gutter embedded in the sticky Title cell. */
export function titleGutterRem(embedded: boolean): number {
  return embedded ? 2 : 3
}

const UPDATED_COL_REM = 6.5
const ADD_COL_REM = 2.5
const RIGHT_RAIL_MIN_REM = 1.75

/**
 * The inline grid template — sticky Title (including its selection gutter),
 * one bordered column per schema property, Updated, optional "+" column, and
 * a trailing filler track so a narrow table stays compact instead of
 * stretching two columns across a wide monitor.
 *
 * `minWidth` is the template's exact floor so the header, rows, group
 * shelves, "+ New" line, and footer scroll sideways in lockstep.
 */
export function collectionGridStyle(
  type: TagType,
  widths: Record<string, number> = {},
  options: { embedded?: boolean; showAddColumn?: boolean } = {},
): CSSProperties {
  const embedded = options.embedded ?? false
  const showAddColumn = options.showAddColumn ?? false
  const gutterRem = titleGutterRem(embedded)
  const titleContentRem = widths[TITLE_SORT_KEY] ?? defaultTitleRem(embedded)
  const titleTotalRem = gutterRem + titleContentRem
  const propertyRems = type.properties.map(
    (property) => widths[property.key] ?? defaultColumnRem(property),
  )
  const tracks = [
    `${titleTotalRem}rem`,
    ...propertyRems.map((rem) => `${rem}rem`),
    `${UPDATED_COL_REM}rem`,
    ...(showAddColumn ? [`${ADD_COL_REM}rem`] : []),
    `minmax(${RIGHT_RAIL_MIN_REM}rem, 1fr)`,
  ]
  const minRem =
    titleTotalRem +
    propertyRems.reduce((total, rem) => total + rem, 0) +
    UPDATED_COL_REM +
    (showAddColumn ? ADD_COL_REM : 0) +
    RIGHT_RAIL_MIN_REM

  return {
    gridTemplateColumns: tracks.join(' '),
    minWidth: `${minRem}rem`,
  }
}
