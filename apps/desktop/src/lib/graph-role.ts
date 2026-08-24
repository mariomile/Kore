import {
  createNoteIfAbsent,
  GRAPH_META_PATH,
  graphMetaSource,
  parseGraphMetaFrontmatter,
  parseNote,
  readNote,
  upsertFrontmatter,
  writeNote,
  type GraphRole,
} from '@reflect/core'

/**
 * Read/write the vault's Personal vs Company role (`graph.md`). Markdown is
 * the source of truth; settings cache the last known role for the switcher.
 */

let queuedRole: GraphRole | null = null

/** Stamp the next graph open with this role (chooser → create/open). */
export function queueGraphRole(role: GraphRole): void {
  queuedRole = role
}

/**
 * Drop a queued role that never landed — cancelled folder pickers, failed
 * creates, opening an existing recent. Without this, the next graph open
 * (including a personal vault) would inherit a leftover company stamp.
 */
export function clearQueuedGraphRole(): void {
  queuedRole = null
}

/** Consume a queued role, or `null` when the chooser did not pick one. */
export function takeQueuedGraphRole(): GraphRole | null {
  const role = queuedRole
  queuedRole = null
  return role
}

/** Read `graph.md` from the open graph, or `null` when unmarked/missing. */
export async function readGraphRole(generation: number): Promise<GraphRole | null> {
  try {
    const source = await readNote(GRAPH_META_PATH, generation)
    return parseGraphMetaFrontmatter(parseNote({ path: GRAPH_META_PATH, source }).frontmatter)
  } catch {
    return null
  }
}

/** Write (or patch) `graph.md` with `role`. Existing body survives a patch. */
export async function writeGraphRole(role: GraphRole, generation: number): Promise<void> {
  const created = await createNoteIfAbsent(GRAPH_META_PATH, graphMetaSource(role), generation)
  if (created.kind === 'created') {
    return
  }
  const source = await readNote(GRAPH_META_PATH, generation)
  await writeNote(GRAPH_META_PATH, upsertFrontmatter(source, { lore: 'graph', role }), generation)
}
