import { z } from 'zod'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import { slugForTitle } from '../markdown/slug'
import { createNoteIfAbsent, listFiles, readNote } from '../graph/commands'
import { journalTailDigest, memoryDigest } from './memory-digest'
import {
  newAgentMemorySeed,
  newAgentSoulSeed,
  newSharedFactsSeed,
  newSharedLogSeed,
  newUserMemorySeed,
} from './agent-profile-seeds'

export * from './agent-profile-seeds'
export * from './agent-memory-pending'

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

/**
 * The shared memory space (Notion's Lore model, vault-native): knowledge
 * every agent — and the user — reads and writes, not one profile's own.
 */
export const AGENT_SHARED_DIR = 'agents/memory'

/**
 * Shared facts and decisions: one bullet per durable fact, updated in place,
 * each carrying a confidence tag (`[certain]` / `[likely]` / `[speculative]`)
 * and a provenance signature (agent slug + date).
 */
export const AGENT_SHARED_FACTS_PATH = 'agents/memory/facts.md'

/**
 * The shared session journal: newest entry appended last, one `##` heading
 * per work session (`## YYYY-MM-DD — <agent>`), a few bullets each. The
 * digest injects the tail, so recency wins by construction.
 */
export const AGENT_SHARED_LOG_PATH = 'agents/memory/log.md'

/**
 * Staged memory writes awaiting the user's approval (when the approval
 * setting is on): agents append proposal sections here instead of touching
 * the memory files, and the Agents screen applies or discards each one.
 */
export const AGENT_PENDING_MEMORY_PATH = 'agents/memory/pending.md'

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
 * Prompt budgets, progressive-disclosure model (bb's catalog): the soul
 * rides whole up to its cap — identity must not arrive summarized — while
 * a memory file that outgrows its budget contributes a deterministic
 * skeleton (headings + first line each, see `memory-digest`) and the
 * prompt points the agent at the file itself for the details. The digest
 * budgets are deliberately small: the whole memory block stays near bb's
 * ~4k characters however much the vault knows, because depth is read on
 * demand instead of shipped with every turn.
 */
export const AGENT_SOUL_MAX_CHARS = 6000
export const AGENT_USER_MEMORY_MAX_CHARS = 1500
export const AGENT_MEMORY_MAX_CHARS = 1500
export const AGENT_SHARED_FACTS_MAX_CHARS = 1500
export const AGENT_SHARED_LOG_MAX_CHARS = 1000

/** One loaded agent file: body (frontmatter stripped), possibly digested. */
export interface AgentFile {
  body: string
  /**
   * True when `body` is a digest of a larger file (a skeleton, or the
   * journal's newest entries) — the prompt then adds a read-on-demand
   * pointer to the full file.
   */
  truncated: boolean
}

/**
 * Read one agent file for prompt injection, or `null` when there is nothing
 * to send: missing/unreadable file, empty body, or `private: true` (the
 * hard block applies to agent files like to any note).
 */
async function loadAgentFile(
  path: string,
  maxChars: number,
  options?: { takeTail?: boolean; digest?: boolean },
): Promise<AgentFile | null> {
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
  if (body.length <= maxChars) {
    return { body, truncated: false }
  }
  if (options?.takeTail === true) {
    // Journals append, so whole newest entries are the part worth sending.
    const digest = journalTailDigest(body, maxChars)
    return { body: digest.text, truncated: true }
  }
  if (options?.digest === true) {
    // Curated files over budget send their skeleton, not a blind head-cut.
    const digest = memoryDigest(body, maxChars)
    return { body: digest.text, truncated: true }
  }
  return { body: body.slice(0, maxChars), truncated: true }
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
  /** Shared facts and decisions every agent reads ({@link AGENT_SHARED_FACTS_PATH}). */
  sharedFacts: AgentFile | null
  /** The tail of the shared session journal ({@link AGENT_SHARED_LOG_PATH}). */
  sharedLog: AgentFile | null
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
  const [soul, userMemory, agentMemory, sharedFacts, sharedLog] = await Promise.all([
    profile === null
      ? Promise.resolve(null)
      : loadAgentFile(profile.soulPath, AGENT_SOUL_MAX_CHARS),
    loadAgentFile(AGENT_USER_MEMORY_PATH, AGENT_USER_MEMORY_MAX_CHARS, { digest: true }),
    loadAgentFile(memoryPath, AGENT_MEMORY_MAX_CHARS, { digest: true }),
    loadAgentFile(AGENT_SHARED_FACTS_PATH, AGENT_SHARED_FACTS_MAX_CHARS, { digest: true }),
    loadAgentFile(AGENT_SHARED_LOG_PATH, AGENT_SHARED_LOG_MAX_CHARS, { takeTail: true }),
  ])
  return { profile, soul, userMemory, agentMemory, sharedFacts, sharedLog, memoryPath }
}

/**
 * The wake-up digest for the active agent — soul first (it colors
 * everything after it), then what the agents know about the user, the
 * shared facts, the tail of the shared journal, this agent's own memory,
 * and finally the upkeep rules matched to what the run may do. The order
 * is deliberate: identity, then shared knowledge, then private notes.
 */
export function agentContextPromptLines(
  context: AgentPromptContext | null,
  options: { canEdit: boolean; writeApproval?: boolean },
): string[] {
  const lines: string[] = []
  const memoryPath = context?.memoryPath ?? agentMemoryPath(DEFAULT_AGENT_SLUG)
  const signature = context?.profile?.slug ?? DEFAULT_AGENT_SLUG
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
        `[summary of a longer file — read ${AGENT_USER_MEMORY_PATH} when you need the full profile]`,
      )
    }
  }
  if (context?.sharedFacts != null) {
    lines.push(
      '',
      `Shared memory — facts and decisions every agent in this vault relies on (${AGENT_SHARED_FACTS_PATH}; each entry carries a confidence tag and who recorded it):`,
      context.sharedFacts.body,
    )
    if (context.sharedFacts.truncated) {
      lines.push(
        `[summary of a longer file — read ${AGENT_SHARED_FACTS_PATH} when a fact you need is elided]`,
      )
    }
  }
  if (context?.sharedLog != null) {
    lines.push(
      '',
      `Recent agent activity — the tail of the shared session journal (${AGENT_SHARED_LOG_PATH}), newest last:`,
      context.sharedLog.body,
    )
    if (context.sharedLog.truncated) {
      lines.push(`[newest entries only — read ${AGENT_SHARED_LOG_PATH} for the full journal]`)
    }
  }
  if (context?.agentMemory != null) {
    lines.push(
      '',
      `Your own working memory from earlier sessions (${memoryPath}):`,
      context.agentMemory.body,
    )
    if (context.agentMemory.truncated) {
      lines.push(`[summary of a longer file — read ${memoryPath} when you need the rest]`)
    }
  }
  lines.push(
    '',
    'Recall: this digest is only the hot set — the vault itself is your long-term memory. Memory sections marked as summaries elide detail on purpose: read the named file when a turn needs it. When the digest lacks context, search the notes (dailies, linked notes, older journal entries) before concluding you don’t know.',
  )
  if (!options.canEdit) {
    lines.push(
      '',
      `Memory upkeep: you cannot edit notes in this mode. When you learn something durable, say so and suggest the exact line — for ${AGENT_USER_MEMORY_PATH} when it is about the user, ${AGENT_SHARED_FACTS_PATH} when every agent should know it, or ${memoryPath} for your own note-to-self — never claim to have saved it.`,
    )
    return lines
  }
  lines.push(
    '',
    'Memory upkeep — route each durable learning to the right file (create any of them when missing):',
    `- Facts about the user (preferences, context, how they like to work) → ${AGENT_USER_MEMORY_PATH}.`,
    `- Facts and decisions every agent should know (project state, conventions, "we chose X over Y") → ${AGENT_SHARED_FACTS_PATH}, one bullet per fact, tagged with confidence and signed: "- [certain|likely|speculative] <fact> — ${signature}, <YYYY-MM-DD>". Update or remove a stale bullet in place instead of adding a contradicting one.`,
    `- Your own lessons and working state → ${memoryPath}.`,
    `- End of a session in which you changed notes or learned something: append one short entry to ${AGENT_SHARED_LOG_PATH} — "## <YYYY-MM-DD> — ${signature}" plus two or three bullets on what you did and learned.`,
    'Keep every memory file short and curated — merge and rewrite instead of appending forever — and never store secrets or the content of private notes.',
    ...(options.writeApproval === true
      ? [
          `Memory writes need the user's approval: do NOT edit ${AGENT_USER_MEMORY_PATH} or ${AGENT_SHARED_FACTS_PATH} directly. Instead, append a proposal section to ${AGENT_PENDING_MEMORY_PATH}: a heading "## <YYYY-MM-DD> ${signature} → <target path>" followed by the bullet lines to add. The user approves or discards each proposal from the Agents screen. The session journal (${AGENT_SHARED_LOG_PATH}) and your own memory file are exempt — write those directly.`,
        ]
      : []),
  )
  return lines
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

/** Seed the shared memory space (facts + journal) if missing. */
export async function ensureSharedMemoryNotes(generation: number): Promise<void> {
  await createNoteIfAbsent(AGENT_SHARED_FACTS_PATH, newSharedFactsSeed(), generation)
  await createNoteIfAbsent(AGENT_SHARED_LOG_PATH, newSharedLogSeed(), generation)
}
