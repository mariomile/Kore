/**
 * The left-rail column every sidebar row shares, in px from the row's own
 * left edge: the row inset before the 18px icon slot (the nav rows' `px-2.5`),
 * the step a nested level adds, and where a label starts (slot + 12px gap).
 * Section headers, icons and labels line up on these, so the Tags and
 * Folders titles sit flush with the rows beneath them.
 */
export const SIDEBAR_ROW_INSET_PX = 10
export const SIDEBAR_INDENT_PX = 12
export const SIDEBAR_LABEL_OFFSET_PX = 30

/** Left padding for a tree row at `depth`; icon-less rows start at the label line. */
export function sidebarTreePadding(depth: number, iconless = false): number {
  return SIDEBAR_ROW_INSET_PX + depth * SIDEBAR_INDENT_PX + (iconless ? SIDEBAR_LABEL_OFFSET_PX : 0)
}

/**
 * Every shelf row's height (tags, folders, notes, library, pinned): one
 * 28px rhythm under the nav, whatever the row holds.
 */
export const SIDEBAR_ROW_HEIGHT_CLASS = 'min-h-7'

/** A clickable tree row's layout: icon, 12px gap, label, trailing count. */
export const SIDEBAR_TREE_ITEM_CLASS = `flex w-full items-center gap-3 rounded-md pr-2.5 text-left leading-5 transition-colors duration-[50ms] ${SIDEBAR_ROW_HEIGHT_CLASS}`

/** Hover group a tree row declares so its icon can turn into a chevron. */
export const SIDEBAR_TREE_ROW_CLASS = 'group/tree-row'

/**
 * A selectable row's colors, the same in light and dark: the selected row
 * keeps the hover wash with full-strength text, the rest darken on hover
 * and a step further while pressed, so a click is felt before the route
 * changes.
 */
export function sidebarRowState(active: boolean): string {
  return active
    ? 'bg-surface-hover text-text'
    : 'text-text-secondary hover:bg-surface-hover hover:text-text active:bg-surface-active'
}
