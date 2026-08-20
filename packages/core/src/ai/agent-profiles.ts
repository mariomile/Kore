import { z } from 'zod'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import { slugForTitle } from '../markdown/slug'
import { createNoteIfAbsent, listFiles, readNote } from '../graph/commands'

/**
 * Agent profiles (Hermes-agent model, vault-native): the `agents/` folder
 * holds one shared `user.md` — what the agents know about the user — and one
 * directory per profile with the two files that make an agent *someone*:
 *
 * - `agents/<slug>/soul.md` — the profile's SOUL: identity, voice, and
 *   boundaries. The user's file: seeded at creation, never auto-rewritten,
 *   injected first ("slot #1") so it colors everything the agent says. Its
 *   frontmatter may pin a `provider` kind and `model` for the profile.
 * - `agents/<slug>/memory.md` — the profile's own working memory: lessons,
 *   conventions, project state. The agent's file, kept current in edit mode.
 *
 * Everything is plain markdown in the graph, so souls and memories are
 * user-visible, editable, linkable, synced, backed up, versioned by the
 * per-note history — and a file flagged `private: true` never reaches a
 * model, which makes privacy the built-in off switch for any of it.
 */

/** The vault directory the agent files live under. */
export const AGENTS_DIR = 'agents'

/** The shared user profile — what agents know about the user (Hermes USER.md). */
export const AGENT_USER_MEMORY_PATH = 'agents/user.md'

/** The memory home used when no profile is active. */
export const DEFAULT_AGENT_SLUG = 'assistant'

/** Graph-relative path of a profile's soul file. */
export function agentSoulPath(slug: string): string {
  return `${AGENTS_DIR}/${slug}/soul.md`
}

/** Graph-relative path of a profile's memory file. */
export function agentMemoryPath(slug: string): string {
  return `${AGENTS_DIR}/${slug}/memory.md`
}

/**
 * Prompt-injection caps (Hermes keeps USER.md ≈1.4k chars and MEMORY.md
 * ≈2.2k; souls run longer). Past a cap the tail is dropped and the prompt
 * says so — the nudge that makes agents consolidate instead of hoarding.
 */
export const AGENT_SOUL_MAX_CHARS = 6000
export const AGENT_USER_MEMORY_MAX_CHARS = 2000
export const AGENT_MEMORY_MAX_CHARS = 4000

/** One loaded agent file: body (frontmatter stripped), capped. */
export interface AgentFile {
  body: string
  truncated: boolean
}

/**
 * Read one agent file for prompt injection, or `null` when there is nothing
 * to send: missing/unreadable file, empty body, or `private: true` (the
 * hard block applies to agent files like to any note).
 */
async function loadAgentFile(path: string, maxChars: number): Promise<AgentFile | null> {
  let source: string
  try {
    source = await readNote(path)
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
  const truncated = body.length > maxChars
  return { body: truncated ? body.slice(0, maxChars) : body, truncated }
}

/** The optional per-profile provider pin carried in soul frontmatter. */
const soulFrontmatterExtrasSchema = z.object({
  provider: z.string().optional().catch(undefined),
  model: z.string().optional().catch(undefined),
})

export interface AgentProfile {
  /** Directory name under `agents/`. */
  slug: string
  /** Display name: the soul's H1, or the slug when it has none. */
  name: string
  /** Preferred provider kind (`claude-cli`, `codex-cli`, …) or null. */
  provider: string | null
  /** Preferred model id within that provider, or null for its default. */
  model: string | null
  soulPath: string
  memoryPath: string
}

const SOUL_PATH_RE = /^agents\/([^/]+)\/soul\.md$/

/** The soul's H1 text, or null. */
function soulTitle(body: string): string | null {
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    return trimmed.startsWith('# ') ? trimmed.slice(2).trim() : null
  }
  return null
}

/** Build one profile from its soul file's content. */
function profileFrom(slug: string, soulSource: string): AgentProfile {
  const split = splitFrontmatter(soulSource)
  const extras = soulFrontmatterExtrasSchema.parse(parseFrontmatter(split.raw).data)
  return {
    slug,
    name: soulTitle(split.body) ?? slug,
    provider: extras.provider?.trim() || null,
    model: extras.model?.trim() || null,
    soulPath: agentSoulPath(slug),
    memoryPath: agentMemoryPath(slug),
  }
}

/**
 * List the graph's agent profiles: every `agents/<slug>/soul.md`, A→Z by
 * slug. An unreadable soul drops its profile rather than the whole list.
 */
export async function listAgentProfiles(): Promise<AgentProfile[]> {
  const files = await listFiles()
  const slugs = files
    .map((file) => SOUL_PATH_RE.exec(file.path)?.[1])
    .filter((slug): slug is string => slug !== undefined)
    .sort()
  const profiles: AgentProfile[] = []
  for (const slug of slugs) {
    try {
      profiles.push(profileFrom(slug, await readNote(agentSoulPath(slug))))
    } catch {
      // A private or unreadable soul hides its profile from the picker.
    }
  }
  return profiles
}

/** Everything a chat run injects about the active agent. */
export interface AgentPromptContext {
  /** The active profile, or null when running as the plain assistant. */
  profile: AgentProfile | null
  soul: AgentFile | null
  userMemory: AgentFile | null
  agentMemory: AgentFile | null
  /** Where this run's agent keeps its own memory (exists or not yet). */
  memoryPath: string
}

/**
 * Load the prompt context for `activeSlug` (null: the default assistant —
 * no soul, but still the shared user memory and the default memory home).
 * Every read degrades to "nothing to send"; loading never blocks a turn.
 */
export async function loadAgentContext(activeSlug: string | null): Promise<AgentPromptContext> {
  let profile: AgentProfile | null = null
  if (activeSlug !== null && activeSlug !== '') {
    try {
      profile = profileFrom(activeSlug, await readNote(agentSoulPath(activeSlug)))
    } catch {
      profile = null
    }
  }
  const memoryPath = agentMemoryPath(profile?.slug ?? DEFAULT_AGENT_SLUG)
  const [soul, userMemory, agentMemory] = await Promise.all([
    profile === null
      ? Promise.resolve(null)
      : loadAgentFile(profile.soulPath, AGENT_SOUL_MAX_CHARS),
    loadAgentFile(AGENT_USER_MEMORY_PATH, AGENT_USER_MEMORY_MAX_CHARS),
    loadAgentFile(memoryPath, AGENT_MEMORY_MAX_CHARS),
  ])
  return { profile, soul, userMemory, agentMemory, memoryPath }
}

/**
 * The prompt block for the active agent — soul first (it colors everything
 * after it), then what the agent knows about the user, then its own working
 * memory, then the upkeep instruction matched to what this run may do.
 */
export function agentContextPromptLines(
  context: AgentPromptContext | null,
  options: { canEdit: boolean },
): string[] {
  const lines: string[] = []
  const memoryPath = context?.memoryPath ?? agentMemoryPath(DEFAULT_AGENT_SLUG)
  if (context?.soul != null && context.profile !== null) {
    lines.push(
      '',
      `Your soul — who you are, set by the user in ${context.profile.soulPath}. Embody it consistently; it wins over the style rules below:`,
      context.soul.body,
    )
    if (context.soul.truncated) {
      lines.push(`[soul truncated at ${AGENT_SOUL_MAX_CHARS} characters]`)
    }
  }
  if (context?.userMemory != null) {
    lines.push(
      '',
      `About the user (from ${AGENT_USER_MEMORY_PATH} — durable facts and preferences agents have learned):`,
      context.userMemory.body,
    )
    if (context.userMemory.truncated) {
      lines.push(
        `[user profile truncated at ${AGENT_USER_MEMORY_MAX_CHARS} characters — it needs pruning]`,
      )
    }
  }
  if (context?.agentMemory != null) {
    lines.push(
      '',
      `Your working memory from earlier sessions (${memoryPath}):`,
      context.agentMemory.body,
    )
    if (context.agentMemory.truncated) {
      lines.push(
        `[memory truncated at ${AGENT_MEMORY_MAX_CHARS} characters — consolidate before adding more]`,
      )
    }
  }
  lines.push(
    '',
    options.canEdit
      ? `Memory upkeep: durable facts about the user (preferences, context, how they like to work) belong in ${AGENT_USER_MEMORY_PATH}; your own lessons, conventions, and ongoing project state belong in ${memoryPath}. Create either file when it does not exist. Keep both short and organized — merge and rewrite stale entries instead of appending forever — and never store secrets or the content of private notes.`
      : `Memory upkeep: you cannot edit notes in this mode. When you learn something durable, say so and suggest the exact line — for ${AGENT_USER_MEMORY_PATH} when it is about the user, for ${memoryPath} when it is your own note-to-self — never claim to have saved it.`,
  )
  return lines
}

/** The seeded soul for a new profile — a starting point, meant to be edited. */
export function newAgentSoulSeed(options: {
  name: string
  provider?: string | null
  model?: string | null
}): string {
  const frontmatter = [
    '---',
    ...(options.provider ? [`provider: ${options.provider}`] : []),
    ...(options.model ? [`model: ${options.model}`] : []),
    '---',
    '',
  ]
  return [
    ...(options.provider || options.model ? frontmatter : []),
    `# ${options.name.trim()}`,
    '',
    '## Identity',
    '',
    `You are ${options.name.trim()}, an agent living in this vault. Rewrite this file to shape who you are — it is injected first into every session.`,
    '',
    '## Voice',
    '',
    '- Concise and warm. Short paragraphs over walls of text.',
    '- Say what you did, not what you might do.',
    '',
    '## Boundaries',
    '',
    '- Ask before acting outside the vault or on anything irreversible.',
    '- Never touch private notes; never store secrets in memory files.',
    '',
  ].join('\n')
}

/** The seeded memory file for a new profile. */
export function newAgentMemorySeed(name: string): string {
  return `# ${name.trim()} — Memory\n\nWorking notes this agent keeps for itself. It curates this file; feel free to edit or prune.\n`
}

/** The seeded shared user profile (created lazily from the Agents screen). */
export function newUserMemorySeed(): string {
  return '# About you\n\nWhat your agents know about you — name, role, preferences, how you like to work. Agents keep this current; edit it any time.\n'
}

/**
 * Create a new profile: a seeded soul and memory under a title-derived slug
 * (`-2` suffix on collision, claimed atomically). Returns the profile.
 */
export async function createAgentProfile(options: {
  name: string
  provider?: string | null
  model?: string | null
  generation: number
}): Promise<AgentProfile> {
  const name = options.name.trim()
  if (name === '') {
    throw new Error('the agent needs a name')
  }
  const base = slugForTitle(name)
  const soul = newAgentSoulSeed({
    name,
    provider: options.provider ?? null,
    model: options.model ?? null,
  })
  for (let ordinal = 1; ordinal <= 100; ordinal += 1) {
    const slug = ordinal === 1 ? base : `${base}-${ordinal}`
    const outcome = await createNoteIfAbsent(agentSoulPath(slug), soul, options.generation)
    if (outcome.kind === 'created') {
      await createNoteIfAbsent(agentMemoryPath(slug), newAgentMemorySeed(name), options.generation)
      return profileFrom(slug, soul)
    }
  }
  throw new Error(`no available agent slug for "${name}"`)
}

/** Seed the shared user profile if it does not exist yet. */
export async function ensureUserMemoryNote(generation: number): Promise<void> {
  await createNoteIfAbsent(AGENT_USER_MEMORY_PATH, newUserMemorySeed(), generation)
}
