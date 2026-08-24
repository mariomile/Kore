import type { GraphRole } from '@reflect/core'

/** Hide agents, embeddings, and tag schema until the graph has this many notes. */
export const ADVANCED_SURFACE_NOTE_THRESHOLD = 20

/**
 * Company graphs need types and automations on day one. Personal graphs
 * stay simple until there is enough material to configure.
 */
export function showAdvancedSurfaces(
  noteCount: number,
  role: GraphRole | null | undefined,
): boolean {
  return role === 'company' || noteCount >= ADVANCED_SURFACE_NOTE_THRESHOLD
}
