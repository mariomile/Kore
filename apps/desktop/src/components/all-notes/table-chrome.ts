/**
 * The pinned header row's chrome, shared by the All Notes table and the
 * Collection table (their column templates stay deliberately separate —
 * `ALL_NOTES_GRID` / `COLLECTION_GRID_CLASS`). Solid `bg-surface` occludes
 * virtualized rows scrolling behind the header cleanly on WebKit without
 * per-frame backdrop blur.
 */
export const TABLE_HEADER_CHROME =
  'sticky top-0 z-20 border-b border-border bg-surface py-3 text-[13px] font-medium leading-none text-text-secondary'
