/**
 * The Mac grid's card surface, shared by note cards (all-notes-grid.tsx)
 * and folder cards (folder-subfolders.tsx). No shadow or hover lift: a
 * border tint carries the hover affordance. The sunken surface (not the
 * page's own `surface`) is what draws the card's outline in dark themes,
 * where the hairline border alone all but vanished.
 */
export const GRID_CARD_CLASS =
  'group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-sunken transition-colors duration-150 ease-swift hover:border-border-strong'

/**
 * The button that opens a card. It covers the card instead of wrapping it:
 * WebKit does not clip a box of definite height inside a <button>. The card
 * clips what it holds, so the focus ring is drawn inside (`.kore-card-button`
 * in styles/index.css: the app's unlayered focus rule outranks utilities).
 */
export const GRID_CARD_BUTTON_CLASS = 'kore-card-button absolute inset-0 z-[1] rounded-2xl'
