import { z } from 'zod'

/**
 * How the editor renders markdown syntax characters. `hide` (the default)
 * hides them, `show` always displays them, and `hybrid` reveals them only
 * around the caret.
 *
 * The persisted name is implementation-neutral on purpose: it maps to
 * meowdown's "mark mode" at the editor boundary (`hybrid` becomes meowdown's
 * `focus`), but the settings document must outlive any one editor library.
 */
export const editorMarkdownSyntaxSchema = z.enum(['hide', 'show', 'hybrid']).catch('hide')

export type EditorMarkdownSyntax = z.infer<typeof editorMarkdownSyntaxSchema>

/**
 * Whether the editor underlines misspelled words (the platform's native
 * spell check on the contenteditable). On by default — turning it off is the
 * preference of users who find the underlines noisy in note-taking.
 */
export const editorSpellCheckSchema = z.boolean().catch(true)

/**
 * Whether a note that opens with an empty body starts the editor on a single
 * empty bullet — old Reflect's every-note default. On by default.
 *
 * The bullet is an **editor affordance only**, never persisted on its own: an
 * empty list item serializes to nothing (`docToMarkdown` drops it), so an
 * unedited note still writes an empty file — and a not-yet-created daily-note
 * placeholder stays uncreated until the first real keystroke (the lazy
 * no-litter contract). The seam lives at the editor (`note-pane.tsx`), not the
 * save pipeline, because seeding the document model with the literal `- `
 * markdown would classify lossy and open the note read-only.
 */
export const editorDefaultBulletSchema = z.boolean().catch(true)

/**
 * Whether pressing Return at the end of a heading starts a new bullet on the
 * next line — old Reflect's "type a title, then bullet" capture flow. On by
 * default.
 *
 * Independent of {@link editorDefaultBulletSchema}: that seeds an empty note's
 * first line, this shapes what Enter *after a heading* produces. They are
 * separate keys so each can be turned off on its own.
 */
export const editorBulletAfterHeadingSchema = z.boolean().catch(true)

/**
 * Whether the caret animates smoothly between positions while editing. On by
 * default. Display-only; it never changes the document or stored Markdown.
 */
export const editorSmoothCaretAnimationSchema = z.boolean().catch(true)

/**
 * The editor's reading text size. `small` (the default) is one design-system
 * size down from the prose size (14px); `medium` is the DS prose size (16px)
 * and `large` steps one DS size up (18px). Display-only — it scales the editor
 * body via a CSS variable on the document root (`--editor-font-size`, applied
 * by `EditorTextSizeEffect`) and never touches the stored markdown.
 */
const editorTextSizeEnum = z.enum(['small', 'medium', 'large'])

export const editorTextSizeSchema = editorTextSizeEnum.catch('small')

export type EditorTextSize = z.infer<typeof editorTextSizeSchema>

/** The editor text sizes in picker order, smallest first. */
export const EDITOR_TEXT_SIZE_IDS = editorTextSizeEnum.options

/**
 * Whether note content stretches across the available desktop pane instead
 * of staying in the default centered reading column. Off by default to
 * preserve Reflect Open's existing layout.
 */
export const editorFullWidthSchema = z.boolean().catch(false)

/**
 * The typeface family the note editor renders prose in. `sans` (the default)
 * is the app's Inter stack; `serif` swaps to a book-style serif stack,
 * `system` to the OS UI font, and `mono` to the app's monospace stack.
 * Display-only — it drives a CSS variable on the document root
 * (`--editor-font-family`, applied by `EditorFontFamilyEffect`) and never
 * touches the stored markdown.
 */
export const editorFontFamilySchema = z.enum(['sans', 'serif', 'system', 'mono']).catch('sans')

export type EditorFontFamily = z.infer<typeof editorFontFamilySchema>

/**
 * The vertical rhythm of editor prose. `normal` (the default) keeps the
 * editor's stock line height; `compact` tightens it and `relaxed` opens it
 * up. Display-only — mapped to a line-height override on the note surface via
 * `[data-editor-line-spacing]` on the document root; headings and code blocks
 * keep their own line heights in every mode.
 */
export const editorLineSpacingSchema = z.enum(['compact', 'normal', 'relaxed']).catch('normal')

export type EditorLineSpacing = z.infer<typeof editorLineSpacingSchema>

/**
 * The clamp range for a user-adjustable sidebar width, in CSS pixels. Shared
 * between the schema (so a hand-edited document can't wreck the layout) and
 * the drag interaction (so the handle stops where the schema would clamp).
 */
export interface SidebarWidthRange {
  readonly min: number
  readonly max: number
  /** The width a fresh install starts from — also the double-click reset target. */
  readonly fallback: number
}

/**
 * The workspace (left) sidebar's range. The minimum keeps the sidebar clear
 * of the macOS traffic lights, which float over its top-left corner at an
 * OS-controlled position; the maximum protects the note pane.
 */
export const SIDEBAR_WIDTH_RANGE: SidebarWidthRange = { min: 200, max: 800, fallback: 260 }

/**
 * The contextual (right) panel's range. Its minimum is higher than the
 * workspace sidebar's because the panel's month calendar needs the room.
 */
export const CONTEXT_SIDEBAR_WIDTH_RANGE: SidebarWidthRange = {
  min: 240,
  max: 800,
  fallback: 320,
}

/** Rounds a width to whole pixels and clamps it into the given range. */
export function clampSidebarWidth(range: SidebarWidthRange, width: number): number {
  return Math.min(range.max, Math.max(range.min, Math.round(width)))
}

function sidebarWidthValueSchema(range: SidebarWidthRange) {
  return z
    .number()
    .catch(range.fallback)
    .transform((width) => clampSidebarWidth(range, width))
}

/**
 * The workspace (left) sidebar's width in CSS pixels, set by dragging its
 * right edge. Desktop-only — the mobile tree has its own shell and never
 * reads it. A non-number degrades to the default; an out-of-range number
 * clamps instead of resetting so a near-miss hand-edit keeps its intent.
 */
export const sidebarWidthSchema = sidebarWidthValueSchema(SIDEBAR_WIDTH_RANGE)

/**
 * The contextual (right) panel's width in CSS pixels, set by dragging its
 * left edge. Same resilience contract as {@link sidebarWidthSchema};
 * independent of it because the two panels carry different content densities.
 */
export const contextSidebarWidthSchema = sidebarWidthValueSchema(CONTEXT_SIDEBAR_WIDTH_RANGE)

/**
 * The workspace sidebar's reorderable shelves, in the order they stack under
 * the fixed navigation. A closed set of ids — the sections themselves live in
 * the app; this key only records the arrangement the user dragged them into.
 */
// There is no "open" shelf any more: it repeated the tab strip row for row.
// A stored `open` entry is simply dropped by the normalization below.
const sidebarSectionEnum = z.enum(['pinned', 'folders', 'tags'])

export type SidebarSection = z.infer<typeof sidebarSectionEnum>

/** Every shelf id, in the order a fresh install stacks them. */
export const SIDEBAR_SECTION_IDS: readonly SidebarSection[] = sidebarSectionEnum.options

/**
 * The stored shelf order, normalized to a complete list: unknown or duplicate
 * entries are dropped and any shelf the document does not mention is appended
 * in {@link SIDEBAR_SECTION_IDS} order. That makes the parsed value directly
 * renderable — the sidebar never has to reconcile it — and means a shelf added
 * in a later version simply joins the end of an existing user's arrangement.
 */
export const sidebarSectionsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) => {
    const ordered: SidebarSection[] = []
    for (const entry of entries) {
      const parsed = sidebarSectionEnum.safeParse(entry)
      if (parsed.success && !ordered.includes(parsed.data)) {
        ordered.push(parsed.data)
      }
    }
    return [...ordered, ...SIDEBAR_SECTION_IDS.filter((id) => !ordered.includes(id))]
  })

/**
 * The workspace sidebar's primary navigation rows (Daily notes, New note, All
 * notes, Tasks, Graph), in the order the user dragged them into. Same closed-
 * set contract as {@link sidebarSectionsSchema}: the rows live in the app, this
 * key only records their arrangement. The terminal is not a row: it opens as
 * a tab from the tab strip's "+" menu.
 */
const sidebarNavEnum = z.enum(['daily', 'newNote', 'allNotes', 'tasks', 'graph'])

export type SidebarNavItem = z.infer<typeof sidebarNavEnum>

/** Every navigation row id, in the order a fresh install lists them. */
export const SIDEBAR_NAV_IDS: readonly SidebarNavItem[] = sidebarNavEnum.options

/** The stored row order, normalized like {@link sidebarSectionsSchema}. */
export const sidebarNavSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) => {
    const ordered: SidebarNavItem[] = []
    for (const entry of entries) {
      const parsed = sidebarNavEnum.safeParse(entry)
      if (parsed.success && !ordered.includes(parsed.data)) {
        ordered.push(parsed.data)
      }
    }
    return [...ordered, ...SIDEBAR_NAV_IDS.filter((id) => !ordered.includes(id))]
  })

/** Anything on the sidebar's Home surface the user can hide: a row or a shelf. */
export type SidebarHideable = SidebarNavItem | SidebarSection

const sidebarHideableEnum = z.union([sidebarNavEnum, sidebarSectionEnum])

/**
 * The navigation rows and shelves the user hid from the sidebar. Hiding is a
 * layout choice: the item keeps its place in its order and comes back there
 * from the "hidden" menu at the foot of the shelves. Unknown and duplicate
 * entries drop; anything else degrades to nothing hidden.
 */
export const hiddenSidebarItemsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) => {
    const hidden: SidebarHideable[] = []
    for (const entry of entries) {
      const parsed = sidebarHideableEnum.safeParse(entry)
      if (parsed.success && !hidden.includes(parsed.data)) {
        hidden.push(parsed.data)
      }
    }
    return hidden
  })

/**
 * The Details panel's sections (the right rail's note and daily context), by
 * the id their stored arrangement is written in. One closed set across note
 * and daily routes: each route renders the subset it has, in this order
 * unless the user moved them. Events only exist on a day; tasks, outline and
 * the local graph only on a note.
 */
const detailsSectionEnum = z.enum([
  'events',
  'tasks',
  'outline',
  'localGraph',
  'publishedUrl',
  'similar',
  'history',
  'actions',
])

export type DetailsSection = z.infer<typeof detailsSectionEnum>

/** Every Details section id, in the order a fresh install stacks them. */
export const DETAILS_SECTION_IDS: readonly DetailsSection[] = detailsSectionEnum.options

/**
 * The stored Details order, normalized the same way as
 * {@link sidebarSectionsSchema}: a complete list, unknown and duplicate
 * entries dropped, unmentioned sections appended in default order.
 */
export const detailsSectionsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) => {
    const ordered: DetailsSection[] = []
    for (const entry of entries) {
      const parsed = detailsSectionEnum.safeParse(entry)
      if (parsed.success && !ordered.includes(parsed.data)) {
        ordered.push(parsed.data)
      }
    }
    return [...ordered, ...DETAILS_SECTION_IDS.filter((id) => !ordered.includes(id))]
  })

/**
 * The Details sections the user hid. Hiding is a layout choice, not a
 * deletion: the section keeps its place in the order and comes back there.
 * Unknown and duplicate entries drop; anything else degrades to none hidden.
 */
export const hiddenDetailsSectionsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) => {
    const hidden: DetailsSection[] = []
    for (const entry of entries) {
      const parsed = detailsSectionEnum.safeParse(entry)
      if (parsed.success && !hidden.includes(parsed.data)) {
        hidden.push(parsed.data)
      }
    }
    return hidden
  })

/**
 * Move `id` one step up or down among the sections a route actually shows.
 * `present` is that route's set: a step skips over sections it does not
 * render (a note's rail has no Events), so one press always visibly moves the
 * section. Returns the full order unchanged when there is nowhere to go.
 */
export function moveDetailsSection<T extends string = DetailsSection>(
  order: readonly T[],
  present: readonly T[],
  id: T,
  direction: 'up' | 'down',
): T[] {
  const shown = order.filter((entry) => present.includes(entry))
  const at = shown.indexOf(id)
  const neighbor = shown[direction === 'up' ? at - 1 : at + 1]
  if (at === -1 || neighbor === undefined) {
    return [...order]
  }
  return order.map((entry) => (entry === id ? neighbor : entry === neighbor ? id : entry))
}

/**
 * {@link moveDetailsSection} for the sidebar's rows and shelves: one step past
 * the neighbours that are actually on screen (a hidden row, an empty shelf).
 */
export const moveSidebarItem = moveDetailsSection
