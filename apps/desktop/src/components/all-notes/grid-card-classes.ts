/**
 * The surface of a grid card, on the Mac and the phone alike (Craft's
 * register): one step above the ground it sits on, with no border. The
 * grids sit on the sunken ground, so a card is the page's own `surface`
 * with a soft shadow. Where cards sit on the page itself (a folder's
 * subfolder cards above the list view), the ground says so with
 * `data-card-ground="page"` and the card sinks a step instead.
 */
export const GRID_CARD_SURFACE_CLASS =
  'bg-surface shadow-sm in-data-[card-ground=page]:bg-surface-sunken in-data-[card-ground=page]:shadow-none'

/**
 * The Mac grid's card, shared by note cards (all-notes-grid.tsx) and folder
 * cards (folder-subfolders.tsx). The hover lifts the shadow a tier.
 */
export const GRID_CARD_CLASS = `group relative flex flex-col overflow-hidden rounded-2xl ${GRID_CARD_SURFACE_CLASS} transition-shadow duration-150 ease-swift hover:shadow-md`

/**
 * The button that opens a card. It covers the card instead of wrapping it:
 * WebKit does not clip a box of definite height inside a <button>. The card
 * clips what it holds, so the focus ring is drawn inside (`.kore-card-button`
 * in styles/index.css: the app's unlayered focus rule outranks utilities).
 */
export const GRID_CARD_BUTTON_CLASS = 'kore-card-button absolute inset-0 z-[1] rounded-2xl'
