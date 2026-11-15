import type { AllNotesView } from '@kore/core'

/** The layouts the phone's Notes tab can show. */
export type MobileNotesView = 'list' | 'grid' | 'board'

interface MobileNotesViewInput {
  /** The routed tag, folded (`null` on the unfiltered list). */
  tagKey: string | null
  /** Whether the routed tag has a type definition (a schema). */
  typed: boolean
  /** Whether the type has a property the board can group by. */
  boardAvailable: boolean
  /** The global list/grid preference (`allNotesView`). */
  globalView: AllNotesView
  /** The per-tag layouts, shared with the desktop collection page. */
  modes: Readonly<Record<string, AllNotesView>>
}

/**
 * Which layout the phone renders. A typed tag reads its per-tag layout (the
 * same `collectionViewModes` entry the desktop page writes, so a board picked
 * on the Mac opens as a board here); the views the phone has no room for
 * (table, calendar) fall back to the row list, which carries the property
 * line. An untyped tag and the unfiltered list keep the global list/grid
 * preference.
 */
export function mobileNotesView({
  tagKey,
  typed,
  boardAvailable,
  globalView,
  modes,
}: MobileNotesViewInput): MobileNotesView {
  const global: MobileNotesView = globalView === 'grid' ? 'grid' : 'list'
  if (tagKey === null || !typed) {
    return global
  }
  const stored = modes[tagKey]
  if (stored === undefined) {
    return global
  }
  if (stored === 'board') {
    return boardAvailable ? 'board' : 'list'
  }
  return stored === 'grid' ? 'grid' : 'list'
}
