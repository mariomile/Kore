/**
 * The canonical registry of settings page sections, organized in groups.
 * The section cards, the group headers, and the sticky navigator all render
 * from this one structure, so page order, group labels, and jump targets can
 * never drift apart.
 */
export const SETTINGS_GROUPS = [
  {
    id: 'general',
    title: 'General',
    sections: [
      { id: 'appearance', title: 'Appearance' },
      { id: 'editor', title: 'Editor' },
      { id: 'date-time', title: 'Date & time' },
      { id: 'browser', title: 'Browser' },
    ],
  },
  {
    id: 'notes',
    title: 'Notes',
    sections: [
      { id: 'templates', title: 'Note templates' },
      { id: 'all-notes', title: 'All notes' },
      { id: 'tasks', title: 'Tasks' },
      { id: 'search', title: 'Search' },
    ],
  },
  {
    id: 'ai',
    title: 'AI & agents',
    sections: [
      { id: 'ai-providers', title: 'AI providers' },
      { id: 'ai-chat', title: 'AI chat' },
      { id: 'ai-prompts', title: 'AI prompts' },
      { id: 'audio-memos', title: 'Audio memos' },
      { id: 'mcp', title: 'MCP servers' },
      // macOS only — installs files under ~/.agents for terminal coding agents.
      { id: 'agents', title: 'Agents' },
    ],
  },
  {
    id: 'data',
    title: 'Sync & data',
    sections: [
      { id: 'sync', title: 'Sync' },
      // Only shown where the OS frameworks exist — see use-visible-settings-sections.
      { id: 'integrations', title: 'Integrations' },
      { id: 'import', title: 'Import' },
    ],
  },
  {
    id: 'app',
    title: 'Application',
    sections: [
      { id: 'about', title: 'About' },
      { id: 'destructive', title: 'Danger zone' },
    ],
  },
] as const

/** One settings group (a page segment with a label over its section cards). */
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

/** Identifier of one {@link SETTINGS_GROUPS} entry. */
export type SettingsGroupId = SettingsGroup['id']

/** The label a group renders — shared by the page and the navigator. */
export function settingsGroupTitle(id: SettingsGroupId): string {
  return SETTINGS_GROUPS.find((group) => group.id === id)?.title ?? id
}

/** Identifier of one {@link SETTINGS_SECTIONS} entry. */
export type SettingsSectionId = (typeof SETTINGS_GROUPS)[number]['sections'][number]['id']

/** One registered settings section. */
export interface SettingsSectionEntry {
  id: SettingsSectionId
  title: string
}

/** The flat, ordered section list — derived, so it always matches the groups. */
export const SETTINGS_SECTIONS: readonly SettingsSectionEntry[] = SETTINGS_GROUPS.flatMap(
  (group) => group.sections as readonly SettingsSectionEntry[],
)

/** The heading a section renders — shared by its card and the navigator. */
export function settingsSectionTitle(id: SettingsSectionId): string {
  return SETTINGS_SECTIONS.find((section) => section.id === id)?.title ?? id
}

/** The DOM id a section card carries (prefixed to keep document ids unique). */
export function settingsSectionDomId(id: SettingsSectionId): string {
  return `settings-${id}`
}
