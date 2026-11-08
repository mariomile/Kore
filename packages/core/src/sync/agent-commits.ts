import { gitAgentWrites, gitAgentWritesClear, gitCommitPaths, type AgentWrite } from './commands'

/**
 * Agent attribution for the backup (Plan 33, A1). `kore mcp` journals every
 * note an agent writes; before the regular commit, each agent's notes are
 * committed on their own, authored by that agent and carrying a
 * {@link AGENT_TRAILER} trailer, so the activity log can tell who changed
 * what. The CLI's always-on host signs its own commits the same way.
 *
 * A note the owner also edited since the agent wrote it lands in the
 * agent's commit with both edits: the journal names files, not lines.
 */

/** Trailer naming the agent on its commits (`TRAILER` in the CLI's `agent_identity.rs`). */
export const AGENT_TRAILER = 'Kore-Agent'

/** One agent's distinct paths. */
export interface AgentWriteGroup {
  readonly name: string
  readonly email: string
  readonly paths: string[]
}

/**
 * Each agent's distinct paths, agents in the order they first wrote. The
 * CLI already resolved each agent's name and address (`agent_identity.rs`),
 * so this only groups.
 */
export function groupAgentWrites(writes: readonly AgentWrite[]): AgentWriteGroup[] {
  const groups = new Map<string, AgentWriteGroup>()
  for (const write of writes) {
    const group = groups.get(write.email) ?? { name: write.agent, email: write.email, paths: [] }
    if (!group.paths.includes(write.path)) {
      group.paths.push(write.path)
    }
    groups.set(write.email, group)
  }
  return [...groups.values()]
}

/**
 * Commit the journaled agent writes, one commit per agent, then clear what
 * was read. Returns whether any commit was made. Never throws: attribution
 * must not stop the backup, and a journal left in place is retried on the
 * next cycle.
 */
export async function commitAgentWrites(generation: number): Promise<boolean> {
  let journal
  try {
    journal = await gitAgentWrites(generation)
  } catch {
    return false
  }
  if (journal.lines === 0) {
    return false
  }
  let committed = false
  try {
    for (const { name, email, paths } of groupAgentWrites(journal.writes)) {
      const outcome = await gitCommitPaths(
        paths,
        { name, email, trailer: `${AGENT_TRAILER}: ${name}` },
        'Update notes',
        generation,
      )
      committed ||= outcome.committed
    }
    await gitAgentWritesClear(journal.lines, generation)
  } catch {
    return committed
  }
  return committed
}
