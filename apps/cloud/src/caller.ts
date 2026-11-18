/**
 * Who is calling: the owner (the Kore app or CLI holding the owner key) or
 * one named agent the owner approved at the consent page. Every write is
 * stored with its agent's name, so the app's Activity can attribute it.
 */
export interface Caller {
  /** The agent's name as approved; null for the owner. */
  agent: string | null
  /** Whether this caller may write. Read-only agents only see read tools. */
  canWrite: boolean
}

export const OWNER: Caller = { agent: null, canWrite: true }

/** Longest agent name kept on a grant and on each write. */
export const MAX_AGENT_NAME = 60

/** An agent name as typed at consent: one line, trimmed, capped; empty falls back. */
export function cleanAgentName(name: string, fallback: string): string {
  const cleaned = name.replaceAll(/\s+/g, ' ').trim().slice(0, MAX_AGENT_NAME)
  if (cleaned !== '') {
    return cleaned
  }
  const backup = fallback.replaceAll(/\s+/g, ' ').trim().slice(0, MAX_AGENT_NAME)
  return backup === '' ? 'Agent' : backup
}

/** The caller an OAuth grant's props describe; anything malformed reads as read-only. */
export function callerFromProps(props: unknown): Caller {
  const { agent, access } = (props ?? {}) as { agent?: unknown; access?: unknown }
  return {
    agent: typeof agent === 'string' && agent !== '' ? agent : 'Agent',
    canWrite: access === 'write',
  }
}
