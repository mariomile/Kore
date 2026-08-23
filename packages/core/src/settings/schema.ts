import { z } from 'zod'
import { agentRoutinesSchema } from '../ai/agent-routines'
import { mcpServersSchema } from '../ai/mcp'
import { isHttpBaseUrl, normalizeOpenAICompatibleBaseUrl } from '../ai/openai-compatible'

/**
 * The user-settings schema — the policy half of the settings store. Rust
 * persists an opaque JSON object in the OS config dir; this schema owns the
 * known keys, their defaults, and their validation.
 *
 * Resilience contract (mirrors the frontmatter schema): a missing or invalid
 * value degrades to its default (`.catch`) instead of failing the whole load,
 * and unknown keys are preserved (`.passthrough`) so a document written by a
 * newer app version round-trips through an older one without losing fields.
 */

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
export const SIDEBAR_WIDTH_RANGE: SidebarWidthRange = { min: 200, max: 480, fallback: 260 }

/**
 * The contextual (right) panel's range. Its minimum is higher than the
 * workspace sidebar's because the panel's month calendar needs the room.
 */
export const CONTEXT_SIDEBAR_WIDTH_RANGE: SidebarWidthRange = {
  min: 240,
  max: 480,
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
 * The app color theme. `system` (the default) follows the OS preference;
 * every other value pins a concrete variant.
 *
 * The set is deliberately sober — neutral greys in the register the tools
 * this app sits beside use (Cursor, Codex, Notion, Craft), not a palette of
 * hues. Light: `light` (pure white), `ash` (neutral grey page under white
 * cards), `paper` (warm cream). Dark: `dark` (the house cool charcoal),
 * `graphite` (a flat neutral grey), `space` (the marketing site's deep-space
 * purple), `midnight` (pure-black OLED). Colour comes from the accent, which
 * is a separate setting, so the surfaces can stay quiet.
 *
 * Persisted here so the choice survives relaunch. Listed in picker order:
 * the OS default, then light to dark.
 */
const themePreferenceEnum = z.enum([
  'system',
  'light',
  'ash',
  'paper',
  'dark',
  'graphite',
  'space',
  'midnight',
])

export const themePreferenceSchema = themePreferenceEnum.catch('system')

export type ThemePreference = z.infer<typeof themePreferenceSchema>

/** Every theme id, `system` included. */
export const THEME_PREFERENCE_IDS = themePreferenceEnum.options

/**
 * The pinned variants that layer over the dark scope. The single source of
 * truth for the `.dark` class, `color-scheme`, and the light/dark toggle —
 * `public/theme-init.js` repeats the list because it cannot import.
 */
export const DARK_THEME_IDS: readonly ThemePreference[] = ['dark', 'graphite', 'space', 'midnight']

/**
 * The app accent color — the one saturated hue used for solid buttons,
 * selection, focus, and today's daily-note heading. `indigo` (the default)
 * keeps the stock Reflect brand ramp; any other id remaps the accent tokens
 * app-wide via a `data-accent` attribute on the document root. A closed set of
 * named ids — not raw hex — so each id can carry hand-tuned values that read
 * well in both light and dark themes.
 */
const accentColorEnum = z.enum([
  // Ordered as the picker lays them out: one turn around the wheel from
  // indigo, then the neutral.
  'indigo',
  'violet',
  'purple',
  'pink',
  'rose',
  'red',
  'orange',
  'amber',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'slate',
  'custom',
])

export const accentColorSchema = accentColorEnum.catch('indigo')

export type AccentColor = z.infer<typeof accentColorSchema>

/** The preset accent ids, in picker order — `custom` renders as its own swatch. */
export const ACCENT_COLOR_IDS = accentColorEnum.options.filter(
  (id): id is Exclude<AccentColor, 'custom'> => id !== 'custom',
)

/** The stock indigo accent — the custom color's starting value. */
export const DEFAULT_CUSTOM_ACCENT = '#4f46e5'

/**
 * Preset accent swatch colors for pickers, one definition for every surface.
 * These mirror the 500-weight `--accent` values in
 * `design-system/tokens/colors.css` — tune the ramp there first, then here.
 */
export const ACCENT_SWATCH_HEX: Record<Exclude<AccentColor, 'custom'>, string> = {
  indigo: '#4f46e5',
  violet: '#7c3aed',
  purple: '#9333ea',
  pink: '#db2777',
  rose: '#e11d48',
  red: '#dc2626',
  orange: '#ea580c',
  amber: '#d97706',
  lime: '#65a30d',
  green: '#059669',
  emerald: '#10b981',
  teal: '#0d9488',
  cyan: '#0891b2',
  sky: '#0284c7',
  blue: '#2563eb',
  slate: '#475569',
}

/**
 * The hex color applied when {@link accentColorSchema} is `custom`. Stored
 * normalized to lowercase `#rrggbb`; an invalid value degrades to the stock
 * indigo so a hand-edit can't paint the app with an unparsable color.
 */
export const customAccentColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .transform((value) => value.toLowerCase())
  .catch(DEFAULT_CUSTOM_ACCENT)

/**
 * Liquid Glass: translucent, blurred chrome over an accent-tinted backdrop.
 * Orthogonal to the theme — it restyles the surfaces of whichever theme is
 * active rather than being a theme of its own. Off by default.
 */
export const liquidGlassSchema = z.boolean().catch(false)

/**
 * How far Liquid Glass goes when it is on: `subtle` barely tints and blurs
 * (readable on a busy vault), `regular` is the original look, and `strong`
 * leans into the backdrop. A separate key from the on/off switch so turning
 * glass off and back on returns to the intensity the user chose. Ignored
 * entirely while {@link liquidGlassSchema} is false.
 */
const glassIntensityEnum = z.enum(['subtle', 'regular', 'strong'])

export const glassIntensitySchema = glassIntensityEnum.catch('regular')

export type GlassIntensity = z.infer<typeof glassIntensitySchema>

/** The intensities in picker order, faintest first. */
export const GLASS_INTENSITY_IDS = glassIntensityEnum.options

/**
 * How round the app's corners are. Scales the whole radius ramp through a
 * `data-radius` scope on the document root (see the design system's
 * `spacing.css`) rather than restyling components one by one, so every
 * surface — buttons, cards, dialogs, chips — moves together. `default` is
 * the house 8px geometry.
 */
const uiRadiusEnum = z.enum(['sharp', 'small', 'default', 'round'])

export const uiRadiusSchema = uiRadiusEnum.catch('default')

export type UiRadius = z.infer<typeof uiRadiusSchema>

/** The radius steps in picker order, squarest first. */
export const UI_RADIUS_IDS = uiRadiusEnum.options

/**
 * How tightly the app packs its rows. Deliberately narrower than "scale every
 * spacing token": the app styles with Tailwind utilities, not the design
 * system's `--space-*` scale (which it never reads), and rescaling Tailwind's
 * base unit would also resize icons and desync the list virtualizers, whose
 * row heights are numbers in JS. So density is a `data-density` scope in the
 * design system (`spacing.css`), like the radius setting — plus
 * {@link DENSITY_ROW_HEIGHT} for the one consumer that needs the value as a
 * number. A token test asserts the two stay equal.
 */
const uiDensityEnum = z.enum(['compact', 'default', 'comfortable'])

export const uiDensitySchema = uiDensityEnum.catch('default')

export type UiDensity = z.infer<typeof uiDensitySchema>

/** The densities in picker order, tightest first. */
export const UI_DENSITY_IDS = uiDensityEnum.options

/**
 * The interface (chrome) text size. Display-only — mapped to a root
 * font-size scale through a `data-ui-text-size` scope on the document root
 * (see `styles/index.css`), so every rem-based size in the app moves
 * together. `default` keeps the browser's 16px root.
 */
const uiTextSizeEnum = z.enum(['small', 'default', 'large'])

export const uiTextSizeSchema = uiTextSizeEnum.catch('default')

export type UiTextSize = z.infer<typeof uiTextSizeSchema>

/** The interface text sizes in picker order, smallest first. */
export const UI_TEXT_SIZE_IDS = uiTextSizeEnum.options

/**
 * The AI chat's reading text size. Same contract as the editor's
 * `editorTextSize`: display-only, mapped to the `--chat-font-size` variable
 * through a `data-chat-text-size` scope on the document root, applied by
 * `ChatTextSizeEffect`. `medium` is the chat's stock 14px chrome size.
 */
const chatTextSizeEnum = z.enum(['small', 'medium', 'large'])

export const chatTextSizeSchema = chatTextSizeEnum.catch('medium')

export type ChatTextSize = z.infer<typeof chatTextSizeSchema>

/** The chat text sizes in picker order, smallest first. */
export const CHAT_TEXT_SIZE_IDS = chatTextSizeEnum.options

/**
 * Each density's list-row height, in pixels. The CSS side owns the same value
 * through the `[data-density]` scopes in `spacing.css`; this map exists for
 * the All Notes virtualizer, which needs it as a number (it feeds `itemSize`,
 * and a row that renders taller than the virtualizer believes overlaps its
 * neighbour). `theme-tokens.test.ts` fails the build if the two drift.
 */
export const DENSITY_ROW_HEIGHT: Record<UiDensity, number> = {
  compact: 40,
  default: 48,
  comfortable: 56,
}

/**
 * How times of day are displayed throughout the app. `12h` (the default)
 * renders `8:22pm`; `24h` renders `20:22`. Display-only — stored timestamps
 * and daily-note keys are unaffected.
 */
export const timeFormatSchema = z.enum(['12h', '24h']).catch('12h')

export type TimeFormat = z.infer<typeof timeFormatSchema>

/**
 * How calendar dates are displayed throughout the app: `mdy` (the default)
 * renders `June 10th, 2026`, `dmy` renders `10th June 2026`, and `iso`
 * renders `2026-06-10`. Display-only — daily-note filenames and stored dates
 * stay ISO `YYYY-MM-DD` regardless.
 */
export const dateFormatSchema = z.enum(['mdy', 'dmy', 'iso']).catch('mdy')

export type DateFormat = z.infer<typeof dateFormatSchema>

/**
 * Which day opens the calendar week. `monday` (the default) follows ISO 8601;
 * `sunday` matches the North-American convention; `saturday` matches the
 * convention of most Middle-East and North-Africa locales.
 */
export const weekStartDaySchema = z.enum(['monday', 'sunday', 'saturday']).catch('monday')

export type WeekStartDay = z.infer<typeof weekStartDaySchema>

const WEEK_START_DOW: Record<WeekStartDay, 0 | 1 | 6> = { sunday: 0, monday: 1, saturday: 6 }

/**
 * The week-start day in JS `getDay()` numbering (0 = Sunday, 6 = Saturday),
 * which is also date-fns' `weekStartsOn` convention.
 */
export function weekStartDow(weekStartDay: WeekStartDay): 0 | 1 | 6 {
  return WEEK_START_DOW[weekStartDay]
}

/**
 * Tags pinned as one-click filters on the All Notes screen, in display order.
 * The defaults mirror the original app's built-in filter tabs (book/link/
 * person); the screen offers every other tag through its Custom menu, so an
 * empty list still filters fine. Matching is case-insensitive at the query —
 * entries here keep whatever casing the user typed.
 */
export const allNotesFilterTagsSchema = z.array(z.string()).catch(['book', 'link', 'person'])

export type AllNotesFilterTags = z.infer<typeof allNotesFilterTagsSchema>

/**
 * How the All Notes screen lays out its notes: the classic table (desktop) /
 * swipeable row list (mobile), or a masonry card grid. One view preference
 * shared across surfaces.
 */
/**
 * All Notes layout. `table` is the Collection view (TDR 0005) — offered only
 * while the routed tag has a type; `board` groups the same collection by its
 * first select property, so it additionally needs one in the schema. Screens
 * without the prerequisite render `list`.
 */
export const allNotesViewSchema = z.enum(['list', 'grid', 'table', 'board']).catch('list')

export type AllNotesView = z.infer<typeof allNotesViewSchema>

/**
 * The open note tabs (the tab strip and the sidebar's Open section), in strip
 * order, restored at launch, **keyed by graph root**: the settings document
 * is one global file shared across graphs, so without the keying another
 * graph's tabs would render after every switch — and then be destroyed by
 * the strip's self-pruning once they fail to resolve. Daily notes are never
 * stored here — the Daily tab is a fixed "tab zero" the UI provides. A
 * malformed graph entry drops that graph's list rather than resurrecting
 * half a session; a malformed document (including the pre-keying flat-array
 * shape) degrades to no stored sessions.
 */
export const openNoteTabSchema = z.object({
  path: z.string(),
  pinned: z.boolean().catch(false),
})

export type OpenNoteTab = z.infer<typeof openNoteTabSchema>

export const openNoteTabsSchema = z
  .record(z.string(), z.array(openNoteTabSchema).catch([]))
  // An array is also an object to `z.record` (index keys) — the pre-keying
  // shape must degrade to "no sessions", not to a graph named "0".
  .refine((value) => !Array.isArray(value))
  .catch({})

/**
 * Whether semantic search is on. Off by default — turning it on downloads the
 * ~90MB embedding model, and that first network fetch is the user's call
 * (Plan 09). Later launches load the cached model because this flag is set.
 */
export const semanticSearchEnabledSchema = z.boolean().catch(false)

/**
 * Whether new eligible images/PDFs added under `assets/` are automatically
 * described by the configured AI provider into a managed `.reflect.md` description
 * (Plan 20). On by default — only new assets, gated to those referenced by
 * public notes; existing assets are never auto-scanned (the Settings backfill
 * action handles those, with a cost warning). Off disables the automatic path
 * entirely.
 */
export const describeAssetsSchema = z.boolean().catch(true)

/**
 * Whether audio-memo transcripts receive a best-effort AI formatting pass
 * before they are written as Markdown. On by default, matching the original
 * Reflect preference. Turning it off keeps the transcription provider's raw
 * body; transcript-derived title generation remains enabled.
 */
export const transcriptionFormatSchema = z.boolean().catch(true)

/**
 * Whether the user has finished the mobile onboarding choice (Plan 19, step
 * 6): iCloud Drive or this device. Off by default — a fresh install shows
 * the onboarding screen before anything seeds a graph. Once set, later
 * launches open the chosen storage root directly. Mobile-only; desktop has
 * its own chooser, so this key is simply never read there.
 */
export const mobileOnboardedSchema = z.boolean().catch(false)

/**
 * Epoch milliseconds until which the iOS paywall stays dismissed after
 * "Remind me later" (0 = never dismissed). A first-rollout escape hatch: a
 * broken store must never lock users out of their notes, so the entitlement
 * gate stays open while this is in the future. Mobile-only; desktop never
 * reads it.
 */
export const paywallSnoozeUntilSchema = z.number().catch(0)

/**
 * Which storage root the mobile graph lives in (Plan 21): the app's iCloud
 * Drive container (`'icloud'` — the recommended default offered first during
 * onboarding, syncs across devices) or the app-sandbox Documents directory
 * (`'local'` — this device only, and the home of GitHub-cloned graphs).
 * Defaults to `'local'` so installs onboarded before this key existed keep
 * opening the root they already use. Only the *kind* is persisted — absolute
 * container paths change across restore/update and are re-derived every
 * launch. Mobile-only; desktop never reads it.
 */
export const mobileStorageKindSchema = z.enum(['icloud', 'local']).catch('local')

/**
 * The *name* of the iCloud graph the mobile app has open (the container
 * `Documents/` subdirectory name) — the persisted selector now that the
 * container can hold several graphs. A name, never a path: container paths
 * change across restore/update and are re-derived every launch. Empty means
 * "not chosen yet" — launch falls back to the first graph in the container.
 * Only read when `mobileStorage` is `'icloud'`. Mobile-only.
 */
export const mobileGraphNameSchema = z.string().catch('')

/**
 * Whether the Apple Contacts integration is on. Off by default — turning it
 * on triggers the OS contacts permission prompt. Lookups are live, on-demand
 * `CNContactStore` queries (attendee resolution, suggested-contact cards);
 * nothing is mirrored into the index and nothing ever leaves the device.
 */
export const contactsEnabledSchema = z.boolean().catch(false)

/**
 * Whether the Apple Calendar integration is on. Off by default — turning it
 * on triggers the macOS calendar-permission prompt, and that is the user's
 * call. Access is read-only and entirely local (EventKit); see
 * docs/porting/calendar-meetings-integration.md.
 */
export const calendarEnabledSchema = z.boolean().catch(false)

/**
 * EventKit identifiers of the calendars whose events appear beside the daily
 * note. Empty (the default) shows nothing — the Settings section lists every
 * calendar on the Mac for opt-in. Identifiers for since-removed accounts are
 * harmless: the Rust side skips ones it can't resolve.
 */
export const calendarIdsSchema = z.array(z.string()).catch([])

export type CalendarIds = z.infer<typeof calendarIdsSchema>

/**
 * The preset palette for a graph's identity color (the swatch shown next to
 * the graph name). A closed set of named ids — not raw hex — so the UI can
 * map each id to values that read well in both light and dark themes.
 */
export const graphColorSchema = z.enum([
  'indigo',
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'red',
  'pink',
  'purple',
])

export type GraphColor = z.infer<typeof graphColorSchema>

/** Every graph color id, in the order pickers should display them. */
export const GRAPH_COLOR_IDS = graphColorSchema.options

export type GraphColors = Record<string, GraphColor>

/**
 * Identity colors the user has chosen per graph, keyed by the graph's absolute
 * root path. An absent key means the default (the app accent). Entries for
 * forgotten graphs are kept on purpose — re-opening that graph later restores
 * its color. Resilience is per entry: a corrupt value is dropped while the
 * rest load, and a non-object value degrades to the empty record.
 */
export const graphColorsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const colors: GraphColors = {}
    for (const [root, value] of Object.entries(entries)) {
      const parsed = graphColorSchema.safeParse(value)
      if (parsed.success) {
        colors[root] = parsed.data
      }
    }
    return colors
  })

/** One Collection's persisted sort: the property key and direction. */
export const collectionSortSettingSchema = z.object({
  key: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
})
export type CollectionSortSetting = z.infer<typeof collectionSortSettingSchema>

export type CollectionSorts = Record<string, CollectionSortSetting>

/**
 * The Collection view's sort per folded tag key (TDR 0005) — a view
 * preference, like task filters, so leaving and returning to a collection
 * keeps its order. Global across graphs (a sort is workflow, not note
 * content); an absent key means the list's own recall order. Resilience is
 * per entry: a corrupt value is dropped while the rest load.
 */
export const collectionSortsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const sorts: CollectionSorts = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      const parsed = collectionSortSettingSchema.safeParse(value)
      if (parsed.success) {
        sorts[tagKey] = parsed.data
      }
    }
    return sorts
  })

/**
 * The view mode per typed tag (folded key) — on that tag's route it
 * overrides the global {@link allNotesViewSchema} choice, so the board you
 * left on #task doesn't chase you onto #book. Same per-entry resilience as
 * the other collection records.
 */
export const collectionViewModesSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const modes: Record<string, AllNotesView> = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      const parsed = z.enum(['list', 'grid', 'table', 'board']).safeParse(value)
      if (parsed.success) {
        modes[tagKey] = parsed.data
      }
    }
    return modes
  })

/** One condition of a saved collection view (mirrors the desktop's
 * CollectionFilter shape — key, operator, comparison text). */
const savedViewFilterSchema = z.object({
  key: z.string().min(1),
  operator: z.enum(['is', 'contains', 'gt', 'lt', 'empty', 'notEmpty']),
  text: z.string(),
})
export type SavedCollectionViewFilter = z.infer<typeof savedViewFilterSchema>

/**
 * One saved collection view (TDR 0005): a named bundle of view mode, sort,
 * board grouping, and filters — applying it restores the whole lens in one
 * click. Malformed filters drop individually; a malformed view drops whole.
 */
export const savedCollectionViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  view: z.enum(['table', 'board']),
  sort: collectionSortSettingSchema.nullable().catch(null),
  group: z.string().nullable().catch(null),
  filters: z
    .array(z.unknown())
    .catch([])
    .transform((entries) => {
      const filters: SavedCollectionViewFilter[] = []
      for (const entry of entries) {
        const parsed = savedViewFilterSchema.safeParse(entry)
        if (parsed.success) {
          filters.push(parsed.data)
        }
      }
      return filters
    }),
})
export type SavedCollectionView = z.infer<typeof savedCollectionViewSchema>

/** Saved views per folded tag key, per-entry resilient at both levels. */
export const collectionSavedViewsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const views: Record<string, SavedCollectionView[]> = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      if (!Array.isArray(value)) {
        continue
      }
      const parsed: SavedCollectionView[] = []
      for (const entry of value) {
        const view = savedCollectionViewSchema.safeParse(entry)
        if (view.success) {
          parsed.push(view.data)
        }
      }
      if (parsed.length > 0) {
        views[tagKey] = parsed
      }
    }
    return views
  })

/** One Collection table's column layout: hidden property keys and manual
 * column widths (rem). Both empty by default — the schema's order and the
 * type-derived widths rule until the user touches a column. */
export interface CollectionColumnsSetting {
  hidden: string[]
  widths: Record<string, number>
}

export type CollectionColumns = Record<string, CollectionColumnsSetting>

const collectionColumnsEntrySchema = z.object({
  hidden: z.array(z.string()).catch([]),
  widths: z
    .record(z.string(), z.unknown())
    .catch({})
    .transform((entries) => {
      const widths: Record<string, number> = {}
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          widths[key] = value
        }
      }
      return widths
    }),
})

/** Per-tag Collection column layout, same per-entry resilience as
 * {@link collectionSortsSchema}. */
export const collectionColumnsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const columns: CollectionColumns = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      const parsed = collectionColumnsEntrySchema.safeParse(value)
      if (parsed.success) {
        columns[tagKey] = parsed.data
      }
    }
    return columns
  })

/** The board's grouping property per typed tag (folded tag key → property
 * key). Absent = the schema's first `select`. Same per-entry resilience as
 * {@link collectionSortsSchema}; a key the schema no longer declares (or that
 * is no longer a select) simply falls back at render time. */
export type CollectionGroups = Record<string, string>

export const collectionGroupsSchema = z
  .record(z.string(), z.unknown())
  .catch({})
  .transform((entries) => {
    const groups: CollectionGroups = {}
    for (const [tagKey, value] of Object.entries(entries)) {
      if (typeof value === 'string' && value !== '') {
        groups[tagKey] = value
      }
    }
    return groups
  })

/**
 * One saved ⌘K search: the query verbatim, including any filter tokens
 * (`#tag`, `is:pinned`, `links:` …). Displayed as its own text — a query like
 * `#book is:pinned` reads better than any label a save dialog would ask for.
 */
export const savedSearchSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
})

export type SavedSearch = z.infer<typeof savedSearchSchema>

/**
 * The user's saved searches, shown in the empty command palette for one-click
 * recall. Global across graphs — a query is workflow, not note content.
 * Resilience is per entry: a corrupt entry is dropped while the rest load,
 * and a non-array value degrades to the empty list.
 */
export const savedSearchesSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = savedSearchSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
  )

/**
 * Which task groups the Tasks view shows (V1's task filter store). The five
 * date / pin buckets default on; `archived` (completed tasks) defaults off.
 * Persisted so a filter choice survives relaunch. Resilience is per key: an
 * invalid flag degrades to its default, and a non-object value degrades to
 * the whole default set.
 */
export const taskFiltersSchema = z
  .object({
    pinned: z.boolean().catch(true),
    current: z.boolean().catch(true),
    overdue: z.boolean().catch(true),
    upcoming: z.boolean().catch(true),
    other: z.boolean().catch(true),
    archived: z.boolean().catch(false),
  })
  .catch({
    pinned: true,
    current: true,
    overdue: true,
    upcoming: true,
    other: true,
    archived: false,
  })

export type TaskFilters = z.infer<typeof taskFiltersSchema>

/**
 * Task reminders: one native notification per day summarizing the tasks due
 * today and overdue. Off by default — notifications are a capability the
 * user turns on deliberately (the switch also asks the OS for permission).
 */
export const taskRemindersSchema = z.boolean().catch(false)

/**
 * Desktop global quick capture: a system-wide shortcut opens a mini window
 * that appends a line to today's daily note. On by default; turn it off if
 * the binding collides with another app.
 */
export const quickCaptureEnabledSchema = z.boolean().catch(true)

/**
 * The AI providers Reflect can call directly (BYOK — the user's own keys, no
 * Reflect-hosted proxy). `openai-compatible` stores its user-supplied base URL
 * per configured entry.
 */
export const aiProviderIdSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'openai-compatible',
  'claude-cli',
  'codex-cli',
  'cursor-cli',
])

export type AiProviderId = z.infer<typeof aiProviderIdSchema>

const hostedAiProviderIdSchema = z.enum(['openai', 'anthropic', 'google', 'openrouter'])

export type HostedAiProviderId = z.infer<typeof hostedAiProviderIdSchema>

export const openAiCompatibleBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isHttpBaseUrl)
  .transform(normalizeOpenAICompatibleBaseUrl)

/**
 * One configured AI provider: the provider, its default model id, and a key
 * hint. The API key itself lives in the OS keychain (addressed by `id` — see
 * `aiKeySecretName`) and **never** in this document; `keyHint` keeps only the
 * key's trailing characters so the settings UI can identify it. Which entry
 * is the app-wide default is a sibling scalar (`defaultAiProviderId`), not a
 * per-entry flag, so "at most one default" holds by construction.
 * OpenAI-compatible entries additionally carry their API base URL, because it
 * is user configuration rather than a fixed catalog endpoint.
 */
const aiProviderConfigBaseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  keyHint: z.string().catch(''),
})

const openAiProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('openai'),
})

const anthropicProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('anthropic'),
})

const googleProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('google'),
})

const openRouterProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('openrouter'),
})

const hostedAiProviderConfigSchema = z.union([
  openAiProviderConfigSchema,
  anthropicProviderConfigSchema,
  googleProviderConfigSchema,
  openRouterProviderConfigSchema,
])

export type HostedAiProviderConfig = z.infer<typeof hostedAiProviderConfigSchema>

const openAiCompatibleProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('openai-compatible'),
  baseUrl: openAiCompatibleBaseUrlSchema,
})

export type OpenAiCompatibleProviderConfig = z.infer<typeof openAiCompatibleProviderConfigSchema>

/**
 * The Claude Code CLI provider ("subscription" AI): no API key — the locally
 * installed `claude` binary carries its own Claude sign-in, so chat bills
 * the user's subscription. Desktop-only (the CLI can't run on iOS).
 */
const claudeCliProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('claude-cli'),
})

export type ClaudeCliProviderConfig = z.infer<typeof claudeCliProviderConfigSchema>

/**
 * The Codex CLI provider: same contract as the Claude Code entry — no API
 * key, the locally installed `codex` binary carries its own ChatGPT sign-in,
 * so chat bills the user's subscription. Desktop-only.
 */
const codexCliProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('codex-cli'),
})

export type CodexCliProviderConfig = z.infer<typeof codexCliProviderConfigSchema>

/**
 * The Cursor CLI provider: same contract — no API key, the locally
 * installed `cursor-agent` binary carries its own Cursor sign-in, so chat
 * bills the user's subscription. Desktop-only, and read-only: the engine
 * never joins edit mode (see `cliProviderSupportsEdits`).
 */
const cursorCliProviderConfigSchema = aiProviderConfigBaseSchema.extend({
  provider: z.literal('cursor-cli'),
})

export type CursorCliProviderConfig = z.infer<typeof cursorCliProviderConfigSchema>

export const aiProviderConfigSchema = z.discriminatedUnion('provider', [
  openAiProviderConfigSchema,
  anthropicProviderConfigSchema,
  googleProviderConfigSchema,
  openRouterProviderConfigSchema,
  openAiCompatibleProviderConfigSchema,
  claudeCliProviderConfigSchema,
  codexCliProviderConfigSchema,
  cursorCliProviderConfigSchema,
])

export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>

/**
 * The `aiProviders` entry AI features use by default. A dangling or null id
 * is legal (hand-edits, removed entries) — readers resolve it through
 * `defaultAiProvider`, which falls back to the first entry.
 */
export const defaultAiProviderIdSchema = z.string().nullable().catch(null)

/**
 * The model the chat last used: a configured `aiProviders` entry (`configId`)
 * plus a model id within it. Persisted so the next chat session starts on
 * whatever the user picked last; null (the default) means the app default
 * entry and its configured model. A dangling reference is legal (the entry
 * may have been removed since) — readers resolve it through
 * `resolveChatModel`, which falls back to the default entry — and an invalid
 * value degrades to null.
 */
export const chatModelSelectionSchema = z
  .object({
    configId: z.string().min(1),
    modelId: z.string().min(1),
  })
  .nullable()
  .catch(null)

/** A chat model choice — a configured provider entry + a model within it. */
export type ChatModelSelection = NonNullable<z.infer<typeof chatModelSelectionSchema>>

/** Maximum user-configured system prompt size (~5,000 prose tokens). */
export const CHAT_SYSTEM_PROMPT_MAX_LENGTH = 20_000

/** Canonicalize a user-configured chat prompt before storing or sending it. */
export function normalizeChatSystemPrompt(value: string): string {
  return value.trim().slice(0, CHAT_SYSTEM_PROMPT_MAX_LENGTH)
}

/**
 * Additional instructions the user wants included in every AI chat system
 * prompt. Reflect's built-in grounding and privacy rules remain in place;
 * this text is appended after them so users can configure tone, format, and
 * other assistant behavior. Empty (the default) adds nothing. Oversized
 * hand-edited values are truncated so the prompt cannot consume the model's
 * context window on its own.
 */
export const chatSystemPromptSchema = z.string().catch('').transform(normalizeChatSystemPrompt)

/**
 * Chat edit mode: whether agent-CLI chat may create and modify notes (the
 * BYOK engines stay read-only regardless). Off by default — writing is a
 * capability the user turns on deliberately, per graph settings document.
 */
export const chatAllowEditsSchema = z.boolean().catch(false)

/** The active agent profile's slug (`agents/<slug>/`), or null for none. */
export const activeAgentProfileSchema = z.string().nullable().catch(null)

/**
 * Memory write approval: when on, agents stage writes to the user profile
 * and shared facts as pending proposals instead of editing them directly.
 */
export const memoryWriteApprovalSchema = z.boolean().catch(false)

// Scheduled agent routines (automations) live in `ai/agent-routines.ts`;
// the settings document stores them so the Agents screen and the background
// runner share one source of truth.

/**
 * The configured AI providers. Resilience is per entry, not per list: a
 * corrupt entry is dropped while the rest load, so one bad hand-edit can't
 * wipe every configured provider. A non-array value degrades to the empty
 * list.
 */
export const aiProvidersSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = aiProviderConfigSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
  )

/**
 * Where an AI selection prompt's accepted result lands: `replace` swaps the
 * selection for the result; `append` inserts the result after the selection's
 * block (e.g. "Continue writing"). An invalid value degrades to `replace`.
 */
export const aiPromptModeSchema = z.enum(['replace', 'append']).catch('replace')

export type AiPromptMode = z.infer<typeof aiPromptModeSchema>

/**
 * One saved AI selection prompt: a label for the picker and a body sent to
 * the provider. The body may reference the selection with the
 * `{{selectedText}}` placeholder (old Reflect's syntax, so saved v1 prompts
 * port over verbatim); a body without the placeholder gets the selection
 * appended after it.
 */
export const aiPromptSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  body: z.string().min(1),
  mode: aiPromptModeSchema,
})

export type AiPrompt = z.infer<typeof aiPromptSchema>

/**
 * The user's saved AI selection prompts, shown in the editor's AI menu after
 * the built-in set. Global across graphs — prompts are workflow, not note
 * content. Resilience is per entry: a corrupt entry is dropped while the rest
 * load, and a non-array value degrades to the empty list.
 */
export const aiPromptsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = aiPromptSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
  )

export const settingsSchema = z.looseObject({
  editorMarkdownSyntax: editorMarkdownSyntaxSchema,
  editorSpellCheck: editorSpellCheckSchema,
  editorDefaultBullet: editorDefaultBulletSchema,
  editorBulletAfterHeading: editorBulletAfterHeadingSchema,
  editorSmoothCaretAnimation: editorSmoothCaretAnimationSchema,
  editorTextSize: editorTextSizeSchema,
  editorFullWidth: editorFullWidthSchema,
  editorFontFamily: editorFontFamilySchema,
  editorLineSpacing: editorLineSpacingSchema,
  sidebarWidth: sidebarWidthSchema,
  contextSidebarWidth: contextSidebarWidthSchema,
  semanticSearchEnabled: semanticSearchEnabledSchema,
  describeAssets: describeAssetsSchema,
  transcriptionFormat: transcriptionFormatSchema,
  contactsEnabled: contactsEnabledSchema,
  mobileOnboarded: mobileOnboardedSchema,
  mobileStorage: mobileStorageKindSchema,
  mobileGraphName: mobileGraphNameSchema,
  paywallSnoozeUntil: paywallSnoozeUntilSchema,
  theme: themePreferenceSchema,
  accentColor: accentColorSchema,
  customAccentColor: customAccentColorSchema,
  liquidGlass: liquidGlassSchema,
  glassIntensity: glassIntensitySchema,
  uiRadius: uiRadiusSchema,
  uiDensity: uiDensitySchema,
  uiTextSize: uiTextSizeSchema,
  chatTextSize: chatTextSizeSchema,
  timeFormat: timeFormatSchema,
  dateFormat: dateFormatSchema,
  weekStartDay: weekStartDaySchema,
  allNotesFilterTags: allNotesFilterTagsSchema,
  allNotesView: allNotesViewSchema,
  openNoteTabs: openNoteTabsSchema,
  savedSearches: savedSearchesSchema,
  collectionSorts: collectionSortsSchema,
  collectionGroups: collectionGroupsSchema,
  collectionColumns: collectionColumnsSchema,
  collectionViewModes: collectionViewModesSchema,
  collectionSavedViews: collectionSavedViewsSchema,
  taskFilters: taskFiltersSchema,
  taskReminders: taskRemindersSchema,
  quickCaptureEnabled: quickCaptureEnabledSchema,
  calendarEnabled: calendarEnabledSchema,
  calendarIds: calendarIdsSchema,
  graphColors: graphColorsSchema,
  aiProviders: aiProvidersSchema,
  defaultAiProviderId: defaultAiProviderIdSchema,
  chatModelSelection: chatModelSelectionSchema,
  chatSystemPrompt: chatSystemPromptSchema,
  chatAllowEdits: chatAllowEditsSchema,
  activeAgentProfile: activeAgentProfileSchema,
  memoryWriteApproval: memoryWriteApprovalSchema,
  agentRoutines: agentRoutinesSchema,
  mcpServers: mcpServersSchema,
  aiPrompts: aiPromptsSchema,
})

export type Settings = z.infer<typeof settingsSchema>

/** The settings a fresh install starts from (every key at its default). */
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({})
