/**
 * The pinned header row's chrome, shared by the All Notes table and the
 * Collection table (their column templates stay deliberately separate —
 * `ALL_NOTES_GRID` / `COLLECTION_GRID_CLASS`). Glass, not paint (Plan 28):
 * rows dissolve under the pinned header the way content dissolves under the
 * grid's scroll veil.
 */
export const TABLE_HEADER_CHROME =
  'app-glass-row sticky top-0 z-10 border-b border-border py-3 text-[13px] font-medium leading-none text-text-secondary'
