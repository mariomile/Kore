/** A panel the context rail can show; `details` is the one it starts with. */
export type ContextPanel = 'details' | 'chat' | 'calendar' | 'browser' | 'terminal'

/**
 * The one panel the rail always carries where the route has a subject. Every
 * other panel is opt-in through the "+" menu, so the default switcher is a
 * single tab rather than a row of five — the rail opens on what the route is
 * already about.
 */
export const DEFAULT_CONTEXT_PANEL: ContextPanel = 'details'
