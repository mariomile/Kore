import { z } from 'zod'
import { agentRoutinesSchema } from '../ai/agent-routines'
import { mcpServersSchema } from '../ai/mcp'
import {
  activeAgentProfileSchema,
  aiProvidersSchema,
  aiPromptsSchema,
  chatModeSchema,
  chatModelSelectionSchema,
  chatSystemPromptSchema,
  defaultAiProviderIdSchema,
  memoryWriteApprovalSchema,
  transcriptionFormatSchema,
  transcriptionModelsSchema,
} from './schema-ai'
import { browserSearchEngineSchema, browserOpenLinksInAppSchema } from './schema-browser'
import {
  accentColorSchema,
  chatTextSizeSchema,
  customAccentColorSchema,
  dateFormatSchema,
  glassIntensitySchema,
  themePreferenceSchema,
  timeFormatSchema,
  uiDensitySchema,
  uiRadiusSchema,
  uiTextSizeSchema,
  visualThemeSchema,
  weekStartDaySchema,
} from './schema-appearance'
import {
  allNotesFilterTagsSchema,
  allNotesViewSchema,
  collectionColumnsSchema,
  collectionGroupsSchema,
  collectionTableGroupsSchema,
  collectionSavedViewsSchema,
  collectionSortsSchema,
  collectionViewModesSchema,
  savedSearchesSchema,
} from './schema-collections'
import {
  contextSidebarWidthSchema,
  editorBulletAfterHeadingSchema,
  editorDefaultBulletSchema,
  editorFontFamilySchema,
  editorFullWidthSchema,
  editorLineSpacingSchema,
  editorMarkdownSyntaxSchema,
  editorSmoothCaretAnimationSchema,
  editorSpellCheckSchema,
  editorTextSizeSchema,
  sidebarSectionsSchema,
  sidebarWidthSchema,
} from './schema-editor'

export * from './schema-ai'
export * from './schema-appearance'
export * from './schema-browser'
export * from './schema-collections'
export * from './schema-editor'

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
 * Singleton workspace pages that join notes and conversations in the desktop
 * tab strip. Route payloads such as the focused daily date, collection tag, or
 * search query live on the corresponding tab while identity remains the
 * surface name. Settings is a full-page workspace, not a tab, so it is not a
 * surface here — stored `settings` tabs are dropped on parse.
 */
export const workspaceSurfaceSchema = z.enum([
  'daily',
  'allNotes',
  'search',
  'tasks',
  'insights',
  'graphMap',
  'agents',
  'terminal',
  'browser',
])

export type WorkspaceSurface = z.infer<typeof workspaceSurfaceSchema>

export interface OpenNoteTab {
  kind: 'note'
  path: string
  pinned: boolean
}

export interface OpenChatTab {
  kind: 'chat'
  conversationId: string
  pinned: boolean
}

export interface OpenDailyTab {
  kind: 'surface'
  surface: 'daily'
  date: string | null
  pinned: boolean
}

export interface OpenAllNotesTab {
  kind: 'surface'
  surface: 'allNotes'
  tag: string | null
  pinned: boolean
}

export interface OpenSearchTab {
  kind: 'surface'
  surface: 'search'
  query: string
  pinned: boolean
}

export interface OpenStaticSurfaceTab {
  kind: 'surface'
  surface: Exclude<WorkspaceSurface, 'daily' | 'allNotes' | 'search'>
  pinned: boolean
}

export type OpenSurfaceTab = OpenDailyTab | OpenAllNotesTab | OpenSearchTab | OpenStaticSurfaceTab

export type OpenTab = OpenNoteTab | OpenChatTab | OpenSurfaceTab

const openNoteTabStoredSchema = z.object({
  kind: z.literal('note'),
  path: z.string(),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenNoteTab>

const openChatTabStoredSchema = z.object({
  kind: z.literal('chat'),
  conversationId: z.string(),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenChatTab>

const openDailyTabStoredSchema = z.object({
  kind: z.literal('surface'),
  surface: z.literal('daily'),
  date: z.string().nullable().catch(null),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenDailyTab>

const openAllNotesTabStoredSchema = z.object({
  kind: z.literal('surface'),
  surface: z.literal('allNotes'),
  tag: z.string().nullable().catch(null),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenAllNotesTab>

const openSearchTabStoredSchema = z.object({
  kind: z.literal('surface'),
  surface: z.literal('search'),
  query: z.string().catch(''),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenSearchTab>

const openStaticSurfaceTabStoredSchema = z.object({
  kind: z.literal('surface'),
  surface: z.enum(['tasks', 'insights', 'graphMap', 'agents', 'terminal', 'browser']),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenStaticSurfaceTab>

/**
 * Settings used to be a workspace tab. Drop stored entries so a restored
 * session keeps the rest of the strip instead of failing the whole list.
 */
const retiredSettingsTabSchema = z.object({ surface: z.literal('settings') })

function dropRetiredSettingsTabs(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value
  }
  return value.filter((entry) => !retiredSettingsTabSchema.safeParse(entry).success)
}

/** Pre-surface shape: `{ path, pinned }` with no `kind`. */
const legacyOpenNoteTabSchema = z
  .object({
    path: z.string(),
    pinned: z.boolean().catch(false),
  })
  .transform((tab): OpenNoteTab => ({ kind: 'note', path: tab.path, pinned: tab.pinned }))

/**
 * One desktop workspace tab: a note, a chat conversation, or a singleton
 * workspace surface. Lists are restored at launch and keyed by graph root so
 * one graph's session can never leak into another. A malformed graph entry
 * drops that graph's list rather than resurrecting half a session; a malformed
 * document (including the pre-keying flat-array shape) degrades to no stored
 * sessions.
 */
export const openTabSchema: z.ZodType<OpenTab> = z.union([
  openNoteTabStoredSchema,
  openChatTabStoredSchema,
  openDailyTabStoredSchema,
  openAllNotesTabStoredSchema,
  openSearchTabStoredSchema,
  openStaticSurfaceTabStoredSchema,
  legacyOpenNoteTabSchema,
])

export const openTabsSchema = z
  .record(z.string(), z.preprocess(dropRetiredSettingsTabs, z.array(openTabSchema).catch([])))
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
 * Whether the user has finished the mobile onboarding choice (Plan 19, step
 * 6): iCloud Drive or this device. Off by default — a fresh install shows
 * the onboarding screen before anything seeds a graph. Once set, later
 * launches open the chosen storage root directly. Mobile-only; desktop has
 * its own chooser, so this key is simply never read there.
 */
export const mobileOnboardedSchema = z.boolean().catch(false)

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
 * Task reminders: a daily native notification summarizing date-only tasks due
 * today and every overdue task, plus a per-task notification at `@HH:MM` for
 * timed ones. Off by default — notifications are a capability the user turns
 * on deliberately (the switch also asks the OS for permission).
 */
export const taskRemindersSchema = z.boolean().catch(false)

/**
 * Desktop global quick capture: a system-wide shortcut opens a mini window
 * that appends a line to today's daily note. On by default; turn it off if
 * the binding collides with another app.
 */
export const quickCaptureEnabledSchema = z.boolean().catch(true)

/** The keyboard-native default used by the desktop Quick Entry window. */
export const DEFAULT_QUICK_CAPTURE_SHORTCUT = 'Mod-Shift-Slash'

const QUICK_CAPTURE_MODIFIERS = new Set(['Mod', 'Ctrl', 'Alt', 'Shift'])
const QUICK_CAPTURE_KEYS =
  /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Slash|Backslash|Comma|Period|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Backquote|Arrow(?:Up|Down|Left|Right))$/

/** Whether a persisted Quick Entry binding is safe to register system-wide. */
export function isQuickCaptureShortcut(value: string): boolean {
  const parts = value.split('-')
  const key = parts.pop()
  if (key === undefined || !QUICK_CAPTURE_KEYS.test(key) || parts.length === 0) {
    return false
  }
  const uniqueModifiers = new Set(parts)
  return (
    uniqueModifiers.size === parts.length &&
    parts.every((part) => QUICK_CAPTURE_MODIFIERS.has(part)) &&
    parts.some((part) => part === 'Mod' || part === 'Ctrl' || part === 'Alt')
  )
}

/** User-remappable desktop shortcut for opening Quick Entry. */
export const quickCaptureShortcutSchema = z
  .string()
  .refine(isQuickCaptureShortcut)
  .catch(DEFAULT_QUICK_CAPTURE_SHORTCUT)

/**
 * Whether interactions answer with haptic feedback: the macOS trackpad knocks
 * (a switch flipping, a drag snapping into place) and the light impacts iOS
 * fires on taps, checkbox toggles, and confirmations. On by default; off
 * silences both surfaces without touching any OS-level setting.
 */
export const hapticFeedbackSchema = z.boolean().catch(true)

/**
 * Move the legacy `openNoteTabs` document into the generalized `openTabs`
 * field at the untrusted JSON boundary. The legacy key is removed from the
 * parsed value so the next settings write completes the migration.
 */
function migrateOpenTabs(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  if (!('openNoteTabs' in value)) {
    return value
  }
  const entries = Object.entries(value).filter(([key]) => key !== 'openNoteTabs')
  if ('openTabs' in value) {
    return Object.fromEntries(entries)
  }
  return { ...Object.fromEntries(entries), openTabs: value.openNoteTabs }
}

const settingsDocumentSchema = z.looseObject({
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
  sidebarSections: sidebarSectionsSchema,
  contextSidebarWidth: contextSidebarWidthSchema,
  semanticSearchEnabled: semanticSearchEnabledSchema,
  describeAssets: describeAssetsSchema,
  transcriptionFormat: transcriptionFormatSchema,
  transcriptionModels: transcriptionModelsSchema,
  contactsEnabled: contactsEnabledSchema,
  mobileOnboarded: mobileOnboardedSchema,
  mobileStorage: mobileStorageKindSchema,
  mobileGraphName: mobileGraphNameSchema,
  theme: themePreferenceSchema,
  accentColor: accentColorSchema,
  customAccentColor: customAccentColorSchema,
  visualTheme: visualThemeSchema,
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
  openTabs: openTabsSchema,
  savedSearches: savedSearchesSchema,
  collectionSorts: collectionSortsSchema,
  collectionGroups: collectionGroupsSchema,
  collectionTableGroups: collectionTableGroupsSchema,
  collectionColumns: collectionColumnsSchema,
  collectionViewModes: collectionViewModesSchema,
  collectionSavedViews: collectionSavedViewsSchema,
  taskFilters: taskFiltersSchema,
  taskReminders: taskRemindersSchema,
  quickCaptureEnabled: quickCaptureEnabledSchema,
  quickCaptureShortcut: quickCaptureShortcutSchema,
  hapticFeedback: hapticFeedbackSchema,
  browserSearchEngine: browserSearchEngineSchema,
  browserOpenLinksInApp: browserOpenLinksInAppSchema,
  calendarEnabled: calendarEnabledSchema,
  calendarIds: calendarIdsSchema,
  graphColors: graphColorsSchema,
  aiProviders: aiProvidersSchema,
  defaultAiProviderId: defaultAiProviderIdSchema,
  chatModelSelection: chatModelSelectionSchema,
  chatSystemPrompt: chatSystemPromptSchema,
  chatMode: chatModeSchema,
  activeAgentProfile: activeAgentProfileSchema,
  memoryWriteApproval: memoryWriteApprovalSchema,
  agentRoutines: agentRoutinesSchema,
  mcpServers: mcpServersSchema,
  aiPrompts: aiPromptsSchema,
})

export const settingsSchema = z.preprocess(migrateOpenTabs, settingsDocumentSchema)

export type Settings = z.infer<typeof settingsSchema>

/** The settings a fresh install starts from (every key at its default). */
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({})
