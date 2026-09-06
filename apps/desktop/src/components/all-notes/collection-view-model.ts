import type { CollectionPageView, SavedCollectionView } from '@reflect/core'

/** Sentinel id for the unpersisted tab a collection shows before any view is added. */
export const LIVE_COLLECTION_VIEW_ID = '__live'

/** Display name for a collection page view type (the tab's default label). */
export function collectionViewLabel(view: CollectionPageView): string {
  switch (view) {
    case 'board':
      return 'Board'
    case 'calendar':
      return 'Calendar'
    case 'grid':
      return 'Grid'
    default:
      return 'Table'
  }
}

/** `Board`, then `Board 2`, `Board 3`, … against names already on the tab bar. */
export function uniqueCollectionViewName(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) {
    return base
  }
  let suffix = 2
  while (existing.includes(`${base} ${suffix}`)) {
    suffix += 1
  }
  return `${base} ${suffix}`
}

/** Comparable snapshot of a saved view's lens (not its id or display name). */
export function savedViewLensKey(
  view: Pick<SavedCollectionView, 'view' | 'sorts' | 'group' | 'tableGroup' | 'match' | 'filters'>,
): string {
  return JSON.stringify({
    view: view.view,
    sorts: view.sorts,
    group: view.group,
    tableGroup: view.tableGroup,
    match: view.match,
    filters: view.filters,
  })
}

/**
 * Which saved view is selected: a still-present stored id, else the first
 * view whose mode matches the live layout, else the first tab.
 */
export function resolveActiveCollectionViewId(
  views: readonly SavedCollectionView[],
  storedId: string | undefined,
  liveView: CollectionPageView,
): string | null {
  if (views.length === 0) {
    return null
  }
  if (storedId !== undefined && views.some((view) => view.id === storedId)) {
    return storedId
  }
  const matching = views.find((view) => view.view === liveView)
  return matching?.id ?? views[0]?.id ?? null
}
