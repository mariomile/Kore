/** Hide agents, embeddings, and tag schema until the graph has this many notes. */
export const ADVANCED_SURFACE_NOTE_THRESHOLD = 20

/**
 * Search, Agents, and tag-schema chrome stay hidden until there is
 * enough material to configure.
 */
export function showAdvancedSurfaces(noteCount: number): boolean {
  return noteCount >= ADVANCED_SURFACE_NOTE_THRESHOLD
}
