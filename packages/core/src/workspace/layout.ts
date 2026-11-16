import { z } from 'zod'
import { noteListFilterSchema, type NoteListFilter } from '../indexing/note-list-filter'
import { call } from '../ipc/invoke'

/**
 * The main window's workspace layout: per graph, the columns of panes and the
 * tabs each pane restores at launch. It is session state, persisted in its own
 * document (`workspace_layout_*`) rather than in the user settings, because it
 * changes on every navigation and the settings do not.
 */

/**
 * Singleton workspace pages that join notes and conversations in the desktop
 * tab strip. Route payloads such as the focused daily date, collection tag, or
 * search query live on the corresponding tab while identity remains the
 * surface name. Settings is a full-page workspace, not a tab, so it is not a
 * surface here.
 */
export const workspaceSurfaceSchema = z.enum([
  'daily',
  'allNotes',
  'search',
  'tasks',
  'insights',
  'memory',
  'activity',
  'graphMap',
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
  filter: NoteListFilter
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

/**
 * An Obsidian base (`.base` file) or, with a null `path`, the list of every
 * base in the vault. `view` is the selected view's name (null: the first).
 */
export interface OpenBaseTab {
  kind: 'base'
  path: string | null
  view: string | null
  pinned: boolean
}

/** An Obsidian canvas (`.canvas` file) or, with a null `path`, every canvas. */
export interface OpenCanvasTab {
  kind: 'canvas'
  path: string | null
  pinned: boolean
}

/**
 * One note's local graph opened as a page of its own, out of the Details
 * panel. Keyed by the note, like a base by its file: each note's map keeps its
 * own tab.
 */
export interface OpenLocalGraphTab {
  kind: 'localGraph'
  path: string
  pinned: boolean
}

/**
 * A markdown file from the Library (a coding agent's home folder such as
 * `~/.claude`), shown read-only. `root` is the folder's id, `path` the file
 * relative to it.
 */
export interface OpenLibraryTab {
  kind: 'library'
  root: string
  path: string
  pinned: boolean
}

export type OpenTab =
  | OpenNoteTab
  | OpenChatTab
  | OpenSurfaceTab
  | OpenBaseTab
  | OpenCanvasTab
  | OpenLocalGraphTab
  | OpenLibraryTab

/** One workspace pane's persisted tab strip and the tab it last showed. */
export interface OpenPane {
  readonly id: string
  readonly tabs: OpenTab[]
  /** `tabKey` of the pane's active tab, or null when it has none yet. */
  readonly activeKey: string | null
}

/** One workspace column: a stack of panes rendered top to bottom. */
export interface OpenColumn {
  readonly id: string
  readonly panes: OpenPane[]
}

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

const openBaseTabStoredSchema = z.object({
  kind: z.literal('base'),
  path: z.string().nullable().catch(null),
  view: z.string().nullable().catch(null),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenBaseTab>

const openCanvasTabStoredSchema = z.object({
  kind: z.literal('canvas'),
  path: z.string().nullable().catch(null),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenCanvasTab>

const openLocalGraphTabStoredSchema = z.object({
  kind: z.literal('localGraph'),
  path: z.string(),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenLocalGraphTab>

const openLibraryTabStoredSchema = z.object({
  kind: z.literal('library'),
  root: z.string(),
  path: z.string(),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenLibraryTab>

const openDailyTabStoredSchema = z.object({
  kind: z.literal('surface'),
  surface: z.literal('daily'),
  date: z.string().nullable().catch(null),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenDailyTab>

const openAllNotesTabStoredSchema = z.object({
  kind: z.literal('surface'),
  surface: z.literal('allNotes'),
  filter: noteListFilterSchema.catch({ kind: 'all' }),
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
  surface: z.enum(['tasks', 'insights', 'memory', 'activity', 'graphMap', 'terminal', 'browser']),
  pinned: z.boolean().catch(false),
}) satisfies z.ZodType<OpenStaticSurfaceTab>

/**
 * One desktop workspace tab: a note, a chat conversation, or a singleton
 * workspace surface. Lists are restored at launch and keyed by graph root so
 * one graph's session can never leak into another. A malformed tab drops its
 * pane's list rather than resurrecting half a session.
 */
const openTabSchema: z.ZodType<OpenTab> = z.union([
  openNoteTabStoredSchema,
  openChatTabStoredSchema,
  openBaseTabStoredSchema,
  openCanvasTabStoredSchema,
  openLocalGraphTabStoredSchema,
  openLibraryTabStoredSchema,
  openDailyTabStoredSchema,
  openAllNotesTabStoredSchema,
  openSearchTabStoredSchema,
  openStaticSurfaceTabStoredSchema,
])

const openPaneSchema: z.ZodType<OpenPane> = z.object({
  id: z.string().min(1),
  tabs: z.array(openTabSchema).catch([]),
  activeKey: z.string().nullable().catch(null),
})

const openColumnSchema: z.ZodType<OpenColumn> = z.object({
  id: z.string().min(1),
  panes: z.array(openPaneSchema),
})

/**
 * Per graph root, the ordered columns of the workspace, each a stack of panes
 * with its own tab strip. A malformed graph entry drops that graph's layout,
 * and a malformed document degrades to no stored layouts.
 */
export const workspaceLayoutSchema = z
  .record(z.string(), z.array(openColumnSchema).catch([]))
  .catch({})

/** Every graph's stored layout, keyed by graph root. */
export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>

/** Commands that return `()` from Rust serialize as `null` over IPC. */
const voidSchema = z.null()

/** Load the persisted layouts; a fresh install comes back as `{}`. */
export async function loadWorkspaceLayout(): Promise<WorkspaceLayout> {
  return await call('workspace_layout_load', {}, workspaceLayoutSchema)
}

/** Atomically replace the persisted layouts (every graph's, in one document). */
export async function saveWorkspaceLayout(layout: WorkspaceLayout): Promise<void> {
  await call('workspace_layout_save', { layout }, voidSchema)
}
