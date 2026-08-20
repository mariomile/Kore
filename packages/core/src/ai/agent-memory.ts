import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import { readNote } from '../graph/commands'

/**
 * Persistent agent memory: one ordinary note, `notes/agent-memory.md`, that
 * every AI provider reads into its prompt and that agents in edit mode keep
 * current. Making memory a plain note is the point — it is user-visible and
 * user-editable, it backs up, syncs, and versions like everything else, and
 * deleting it forgets everything. A memory note flagged `private: true` is
 * honored like any other private note: it never reaches a model, so marking
 * it private is the built-in "pause memory" switch.
 */

/** Graph-relative path of the memory note. */
export const AGENT_MEMORY_PATH = 'notes/agent-memory.md'

/** The memory note's display title (its wiki-link target). */
export const AGENT_MEMORY_TITLE = 'Agent Memory'

/**
 * Ceiling on the memory text carried into prompts. Memory is meant to be a
 * curated page, not an archive; past this size the tail is dropped and the
 * prompt says so, which nudges the agent to prune.
 */
export const AGENT_MEMORY_MAX_CHARS = 8000

export interface AgentMemory {
  /** The memory note's body (frontmatter stripped), capped. */
  body: string
  /** True when the body was cut at {@link AGENT_MEMORY_MAX_CHARS}. */
  truncated: boolean
}

/**
 * Load the graph's agent memory for prompt injection, or `null` when there
 * is none to send: no memory note yet, an unreadable file, or a memory note
 * marked `private: true` (the hard block applies to memory like to any
 * other note content).
 */
export async function loadAgentMemory(): Promise<AgentMemory | null> {
  let source: string
  try {
    source = await readNote(AGENT_MEMORY_PATH)
  } catch {
    return null
  }
  const split = splitFrontmatter(source)
  if (parseFrontmatter(split.raw).data.private) {
    return null
  }
  const body = split.body.trim()
  if (body === '') {
    return null
  }
  const truncated = body.length > AGENT_MEMORY_MAX_CHARS
  return { body: truncated ? body.slice(0, AGENT_MEMORY_MAX_CHARS) : body, truncated }
}

/**
 * The prompt block carrying the memory (shared by every provider), plus the
 * upkeep instruction matched to what this run may do: an agent that can
 * write is told to keep the note current; a read-only one is told to
 * *suggest* additions instead of pretending it saved something.
 */
export function agentMemoryPromptLines(
  memory: AgentMemory | null,
  options: { canEdit: boolean },
): string[] {
  const lines: string[] = []
  if (memory !== null) {
    lines.push(
      '',
      `Persistent memory (your own notes from earlier sessions, kept in [[${AGENT_MEMORY_TITLE}]] at ${AGENT_MEMORY_PATH}):`,
      memory.body,
    )
    if (memory.truncated) {
      lines.push(`[memory truncated at ${AGENT_MEMORY_MAX_CHARS} characters — it needs pruning]`)
    }
  }
  lines.push(
    '',
    options.canEdit
      ? `Memory upkeep: when you learn something durable — a preference, a convention, ongoing project state — record it in ${AGENT_MEMORY_PATH} (create the note with an H1 "${AGENT_MEMORY_TITLE}" if it does not exist). Keep it short and organized; rewrite stale entries instead of appending forever. Never store secrets or the content of private notes there.`
      : `Memory upkeep: you cannot edit notes in this mode. When you learn something durable worth remembering, say so and suggest the exact line to add to [[${AGENT_MEMORY_TITLE}]] — never claim to have saved it.`,
  )
  return lines
}
