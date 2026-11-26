import { z } from 'zod'
import { call } from '../ipc/invoke'
import type { AgentPresenceEvent } from './agent-presence'
import type { NoteEdit } from './chat/note-edit'

/**
 * The live log `kore mcp` keeps of what agents do in the vault
 * (`.kore/agent-activity.jsonl`): the notes a tool call opened and the lines
 * each write changed, appended by the CLI as it works. This module is the
 * policy over it: which agent to name, which lines to light up in the note,
 * and the edit that takes a write back. The app tails the log
 * ({@link agentActivitySince}) and feeds the events to the presence store.
 */

const activityLineSchema = z.object({
  at: z.number(),
  agent: z.string(),
  path: z.string(),
  kind: z.enum(['read', 'write']),
  /** The MCP client's own name (`clientInfo.name`), for an unnamed agent. */
  client: z.string().optional(),
  created: z.boolean().optional(),
  removed: z.string().optional(),
  added: z.string().optional(),
  contextBefore: z.string().optional(),
  contextAfter: z.string().optional(),
})
type ActivityLine = z.infer<typeof activityLineSchema>

const activityChunkSchema = z.object({ text: z.string(), offset: z.number() })
export type AgentActivityChunk = z.infer<typeof activityChunkSchema>

/** The complete log lines appended since byte `offset`, and where to read next. */
export async function agentActivitySince(
  offset: number,
  generation: number,
): Promise<AgentActivityChunk> {
  return await call('agent_activity_since', { offset, generation }, activityChunkSchema)
}

/** The CLI's name for a caller that did not name itself (`agent_identity::UNNAMED`). */
const UNNAMED_AGENT = 'MCP'

/** Clients whose own name is not how people know them. */
const CLIENT_NAMES: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  'claude-ai': 'Claude',
  codex: 'Codex',
  'codex-mcp-client': 'Codex',
  cursor: 'Cursor',
  'cursor-vscode': 'Cursor',
  'gemini-cli': 'Gemini CLI',
  windsurf: 'Windsurf',
  zed: 'Zed',
}

/**
 * The name to show for an agent: its own when it has one, else the MCP
 * client it came through ("claude-code" → "Claude Code"), else "Agent".
 */
export function agentDisplayName(agent: string, client: string | undefined): string {
  if (agent !== UNNAMED_AGENT) {
    return agent
  }
  const key = client?.trim().toLowerCase()
  if (key === undefined || key === '') {
    return 'Agent'
  }
  return (
    CLIENT_NAMES[key] ??
    key
      .split(/[-_\s]+/)
      .filter((word) => word !== '')
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join(' ')
  )
}

/**
 * The edit that takes a write back, anchored on the unchanged line next to
 * it so it lands exactly where the agent wrote. A note the agent created
 * has nothing to go back to, so it gets none (deleting it is the user's
 * call, from the note itself).
 */
function undoFor(line: ActivityLine): NoteEdit | null {
  const added = line.added ?? ''
  const removed = line.removed ?? ''
  if (line.created === true || added === removed) {
    return null
  }
  const before = line.contextBefore ?? ''
  if (before !== '') {
    return { oldText: before + added, newText: before + removed }
  }
  const after = line.contextAfter ?? ''
  if (after !== '') {
    return { oldText: added + after, newText: removed + after }
  }
  return added === '' ? null : { oldText: added, newText: removed }
}

/** The lines a write added, as the note shows them (blank lines dropped). */
function addedLines(added: string): string[] {
  return added
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** One log line as a presence event, or null when it is not one. */
function toEvent(raw: string): AgentPresenceEvent | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = activityLineSchema.safeParse(json)
  if (!parsed.success) {
    return null
  }
  const line = parsed.data
  const agent = agentDisplayName(line.agent, line.client)
  if (line.kind === 'read') {
    return { agent, kind: 'read', path: line.path, atMs: line.at }
  }
  const undo = undoFor(line)
  return {
    agent,
    kind: 'write',
    path: line.path,
    lines: addedLines(line.added ?? ''),
    ...(undo === null ? {} : { undo }),
    atMs: line.at,
  }
}

/**
 * The presence events in a chunk of the log, oldest first. Events older
 * than `sinceMs` are history, not presence (the app opening onto a log an
 * agent wrote yesterday), and are left out; so are malformed lines.
 */
export function parseAgentActivity(text: string, sinceMs: number): AgentPresenceEvent[] {
  const events: AgentPresenceEvent[] = []
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') {
      continue
    }
    const event = toEvent(raw)
    if (event !== null && event.atMs >= sinceMs) {
      events.push(event)
    }
  }
  return events
}
