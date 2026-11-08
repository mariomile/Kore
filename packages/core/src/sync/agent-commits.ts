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

/** Trailer naming the agent on its commits (shared with the `kore` CLI). */
export const AGENT_TRAILER = 'Kore-Agent'

/** Domain of the address on an agent's commits (shared with the `kore` CLI). */
const AGENT_EMAIL_DOMAIN = 'agents.kore'

/** The agent's name as a git author: one line, no address delimiters. */
export function agentDisplayName(agent: string): string {
  return agent
    .replaceAll(/[\p{Cc}<>]/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .join(' ')
}

/** Lowercase ASCII letters, digits and dashes: the commit address's local part. */
export function agentSlug(agent: string): string {
  const slug = agent
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
  return slug.length > 0 ? slug : 'agent'
}

/** Each agent's distinct paths, agents in the order they first wrote. */
export function groupAgentWrites(writes: readonly AgentWrite[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const write of writes) {
    const name = agentDisplayName(write.agent)
    if (name.length === 0) {
      continue
    }
    const paths = groups.get(name) ?? []
    if (!paths.includes(write.path)) {
      paths.push(write.path)
    }
    groups.set(name, paths)
  }
  return groups
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
    for (const [name, paths] of groupAgentWrites(journal.writes)) {
      const outcome = await gitCommitPaths(
        paths,
        {
          name,
          email: `${agentSlug(name)}@${AGENT_EMAIL_DOMAIN}`,
          trailer: `${AGENT_TRAILER}: ${name}`,
        },
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
