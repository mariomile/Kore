const SETTINGS_SEARCH_TERMS = {
  graph: 'graph storage device icloud this device',
  appearance:
    'appearance theme system light ash paper dark graphite ink space midnight accent color red orange yellow green teal blue purple pink text size small medium large font sans serif mono spacing compact relaxed corners default round liquid glass intensity subtle balanced strong',
  calendar: 'calendar events access open settings',
  editor: 'editor smooth caret animation start bullet bullet after heading typography writing',
  ai: 'ai provider model system prompt api key',
  prompts: 'ai prompts custom prompt add prompt',
  audio: 'audio memo transcription auto format model',
  backup: 'backup sync github',
  about: 'about notes version privacy policy',
} as const

export type MobileSettingsSection = keyof typeof SETTINGS_SEARCH_TERMS

/** Whether a Settings section matches the query and its current dynamic labels. */
export function matchesMobileSettingsSection(
  query: string,
  section: MobileSettingsSection,
  dynamicLabels: readonly string[] = [],
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return true
  }
  return `${SETTINGS_SEARCH_TERMS[section]} ${dynamicLabels.join(' ')}`
    .toLowerCase()
    .includes(needle)
}
