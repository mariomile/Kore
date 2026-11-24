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
  transcriptionLanguageSchema,
} from './schema-ai'
import { browserSearchEngineSchema, browserOpenLinksInAppSchema } from './schema-browser'
import { connectorsSchema } from './schema-connectors'
import {
  pasteCollectFilesSchema,
  pasteCollectImagesSchema,
  pasteCollectLinksSchema,
  pasteCollectPdfsSchema,
  pasteSaveLinkTextSchema,
} from './schema-paste'
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
  allNotesSortSchema,
  folderPagesWithoutSubfoldersSchema,
  allNotesViewSchema,
  collectionActiveViewIdSchema,
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
  detailsSectionsSchema,
  editorBulletAfterHeadingSchema,
  editorDefaultBulletSchema,
  editorFontFamilySchema,
  editorFullWidthSchema,
  editorLineAuthorsSchema,
  editorLineSpacingSchema,
  editorMarkdownSyntaxSchema,
  editorSmoothCaretAnimationSchema,
  editorSpellCheckSchema,
  editorTextSizeSchema,
  hiddenDetailsSectionsSchema,
  hiddenSidebarItemsSchema,
  sidebarNavSchema,
  sidebarSectionsSchema,
  sidebarTabsSchema,
  sidebarWidthSchema,
} from './schema-editor'

export * from './schema-ai'
export * from './schema-appearance'
export * from './schema-browser'
export * from './schema-paste'
export * from './schema-connectors'
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
 * Whether semantic search is on. Off by default — turning it on downloads the
 * ~90MB embedding model, and that first network fetch is the user's call
 * (Plan 09). Later launches load the cached model because this flag is set.
 */
export const semanticSearchEnabledSchema = z.boolean().catch(false)

/**
 * Whether new eligible images/PDFs added under `assets/` are automatically
 * described by the configured AI provider into a managed `.kore.md` description
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
 * Which Tasks view is open (Todoist-style: Inbox / Today / Upcoming /
 * Projects, plus the original bucketed All list). Persisted so the view
 * survives relaunch; mirrors `TaskView` in `indexing/task-views.ts`.
 */
export const taskViewSchema = z
  .enum(['inbox', 'today', 'upcoming', 'projects', 'all'])
  .catch('today')

/** How the Tasks view lays its groups out: a list, or a board of columns. */
export const taskLayoutSchema = z.enum(['list', 'board']).catch('list')

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

/**
 * Settings → Agents → Remote access: the app keeps `kore mcp --http` running
 * for the open graph and publishes it through Tailscale Funnel, so Claude on
 * the web or iPhone, Grok and other cloud agents can use the vault. Off by
 * default: turning it on puts the vault on the internet behind a token.
 */
export const remoteAccessEnabledSchema = z.boolean().catch(false)

/** Remote agents can read but not write while this is on. On by default. */
export const remoteAccessReadOnlySchema = z.boolean().catch(true)

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
 * Open tabs used to live in this document (`openTabs`, earlier `openNoteTabs`);
 * they are the workspace layout's now. Drop the keys so the passthrough schema
 * stops carrying them into every settings save.
 */
function dropWorkspaceLayoutKeys(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  if (!('openTabs' in value) && !('openNoteTabs' in value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'openTabs' && key !== 'openNoteTabs'),
  )
}

/**
 * The Library shelf (coding agents' home folders) starts hidden: it lists every
 * agent tool installed on the Mac, which reads as clutter to anyone not
 * browsing their skills. Applied once per settings document, marked by
 * `libraryShelfDefaulted`, so a user who shows it again from the "hidden"
 * menu keeps it. Fresh installs get the same default.
 */
function hideLibraryShelfOnce(value: unknown): unknown {
  const doc =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  if (doc.libraryShelfDefaulted === true) {
    return value
  }
  const hidden = Array.isArray(doc.hiddenSidebarItems) ? doc.hiddenSidebarItems : []
  return {
    ...doc,
    hiddenSidebarItems: hidden.includes('library') ? hidden : [...hidden, 'library'],
    libraryShelfDefaulted: true,
  }
}

function migrateSettings(value: unknown): unknown {
  return hideLibraryShelfOnce(dropWorkspaceLayoutKeys(value))
}

const settingsDocumentSchema = z.looseObject({
  editorMarkdownSyntax: editorMarkdownSyntaxSchema,
  editorSpellCheck: editorSpellCheckSchema,
  editorDefaultBullet: editorDefaultBulletSchema,
  editorBulletAfterHeading: editorBulletAfterHeadingSchema,
  editorSmoothCaretAnimation: editorSmoothCaretAnimationSchema,
  editorTextSize: editorTextSizeSchema,
  editorFullWidth: editorFullWidthSchema,
  editorLineAuthors: editorLineAuthorsSchema,
  editorFontFamily: editorFontFamilySchema,
  editorLineSpacing: editorLineSpacingSchema,
  sidebarWidth: sidebarWidthSchema,
  sidebarSections: sidebarSectionsSchema,
  sidebarNav: sidebarNavSchema,
  hiddenSidebarItems: hiddenSidebarItemsSchema,
  sidebarTabs: sidebarTabsSchema,
  libraryShelfDefaulted: z.boolean().catch(false),
  contextSidebarWidth: contextSidebarWidthSchema,
  detailsSections: detailsSectionsSchema,
  hiddenDetailsSections: hiddenDetailsSectionsSchema,
  semanticSearchEnabled: semanticSearchEnabledSchema,
  describeAssets: describeAssetsSchema,
  transcriptionFormat: transcriptionFormatSchema,
  transcriptionModels: transcriptionModelsSchema,
  transcriptionLanguage: transcriptionLanguageSchema,
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
  allNotesSort: allNotesSortSchema,
  folderPagesWithoutSubfolders: folderPagesWithoutSubfoldersSchema,
  savedSearches: savedSearchesSchema,
  collectionSorts: collectionSortsSchema,
  collectionGroups: collectionGroupsSchema,
  collectionTableGroups: collectionTableGroupsSchema,
  collectionColumns: collectionColumnsSchema,
  collectionViewModes: collectionViewModesSchema,
  collectionSavedViews: collectionSavedViewsSchema,
  collectionActiveViewId: collectionActiveViewIdSchema,
  taskFilters: taskFiltersSchema,
  taskView: taskViewSchema,
  taskLayout: taskLayoutSchema,
  taskReminders: taskRemindersSchema,
  quickCaptureEnabled: quickCaptureEnabledSchema,
  remoteAccessEnabled: remoteAccessEnabledSchema,
  remoteAccessReadOnly: remoteAccessReadOnlySchema,
  quickCaptureShortcut: quickCaptureShortcutSchema,
  hapticFeedback: hapticFeedbackSchema,
  browserSearchEngine: browserSearchEngineSchema,
  browserOpenLinksInApp: browserOpenLinksInAppSchema,
  pasteCollectLinks: pasteCollectLinksSchema,
  pasteCollectImages: pasteCollectImagesSchema,
  pasteCollectPdfs: pasteCollectPdfsSchema,
  pasteCollectFiles: pasteCollectFilesSchema,
  pasteSaveLinkText: pasteSaveLinkTextSchema,
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
  connectors: connectorsSchema,
})

export const settingsSchema = z.preprocess(migrateSettings, settingsDocumentSchema)

export type Settings = z.infer<typeof settingsSchema>

/** The settings a fresh install starts from (every key at its default). */
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({})
