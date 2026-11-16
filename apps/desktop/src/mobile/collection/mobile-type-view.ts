import type { AllNotesView, CollectionEntry, CollectionPageView, TagProperty } from '@kore/core'

/** The layouts a type's page offers on the phone. */
export type MobileTypeView = 'table' | 'board' | 'gallery'

/** The phone's layouts in switcher order. */
export const MOBILE_TYPE_VIEWS: readonly MobileTypeView[] = ['table', 'board', 'gallery']

/**
 * Which layout the phone renders for the page's resolved view (the same
 * per-tag entry the Mac writes, so a board picked there opens as a board
 * here). The calendar has no phone layout yet and reads as the table, the
 * collection's own shape; the notes list never reaches a type page.
 */
export function mobileTypeView(view: AllNotesView): MobileTypeView {
  if (view === 'board') {
    return 'board'
  }
  return view === 'grid' ? 'gallery' : 'table'
}

/** The stored view a phone layout writes back (`gallery` is the Mac's grid). */
export function storedTypeView(view: MobileTypeView): AllNotesView & CollectionPageView {
  return view === 'gallery' ? 'grid' : view
}

/**
 * The rows whose title contains the search text (case- and accent-blind,
 * like the title filter on a folder page). An empty search keeps every row.
 */
export function rowsMatchingTitle(
  entries: readonly CollectionEntry[],
  query: string,
): readonly CollectionEntry[] {
  const needle = foldForSearch(query.trim())
  if (needle === '') {
    return entries
  }
  return entries.filter((entry) => foldForSearch(entry.title).includes(needle))
}

function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
}

/** Table column widths (px) by property type: a phone shows two at a glance. */
export function mobileColumnWidth(property: TagProperty): number {
  switch (property.type) {
    case 'checkbox':
      return 76
    case 'number':
    case 'rating':
      return 96
    case 'date':
    case 'created':
    case 'updated':
      return 140
    case 'select':
    case 'status':
      return 136
    case 'text':
    case 'multiselect':
    case 'relations':
    case 'reverse':
    case 'files':
      return 184
    default:
      return 156
  }
}
