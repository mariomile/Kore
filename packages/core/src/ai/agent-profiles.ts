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
 * Prompt-injection caps (Hermes keeps USER.md ≈1.4k chars and MEMORY.md
 * ≈2.2k; souls run longer). Past a cap the tail is dropped and the prompt
 * says so — the nudge that makes agents consolidate instead of hoarding.
 */
export const AGENT_SOUL_MAX_CHARS = 6000
export const AGENT_USER_MEMORY_MAX_CHARS = 2000
export const AGENT_MEMORY_MAX_CHARS = 4000
export const AGENT_SHARED_FACTS_MAX_CHARS = 3000
export const AGENT_SHARED_LOG_MAX_CHARS = 2500

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
async function loadAgentFile(
  path: string,
  maxChars: number,
  options?: { takeTail?: boolean },
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
  const truncated = body.length > maxChars
  if (!truncated) {
    return { body, truncated }
  }
  // Journals append, so their tail is the recent part worth sending; every
  // other file is curated head-first.
  const kept = options?.takeTail === true ? body.slice(-maxChars) : body.slice(0, maxChars)
  return { body: kept, truncated }
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
    loadAgentFile(AGENT_USER_MEMORY_PATH, AGENT_USER_MEMORY_MAX_CHARS),
    loadAgentFile(memoryPath, AGENT_MEMORY_MAX_CHARS),
    loadAgentFile(AGENT_SHARED_FACTS_PATH, AGENT_SHARED_FACTS_MAX_CHARS),
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
        `[user profile truncated at ${AGENT_USER_MEMORY_MAX_CHARS} characters — it needs pruning]`,
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
        `[shared facts truncated at ${AGENT_SHARED_FACTS_MAX_CHARS} characters — consolidate them]`,
      )
    }
  }
  if (context?.sharedLog != null) {
    lines.push(
      '',
      `Recent agent activity — the tail of the shared session journal (${AGENT_SHARED_LOG_PATH}), newest last:`,
      context.sharedLog.body,
    )
  }
  if (context?.agentMemory != null) {
    lines.push(
      '',
      `Your own working memory from earlier sessions (${memoryPath}):`,
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
    'Recall: this digest is only the hot set — the vault itself is your long-term memory. When it lacks context you need, search the notes (dailies, linked notes, older journal entries) before concluding you don’t know.',
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

/** One staged memory write awaiting approval. */
export interface PendingMemoryProposal {
  /** The exact heading line (the proposal's identity in the file). */
  heading: string
  /** Target file the proposal wants to append to. */
  target: string
  /** The proposal's body lines (what approval appends). */
  body: string
}

const PENDING_HEADING_RE = /^##\s+(.*?)→\s*(\S+)\s*$/

/** Parse {@link AGENT_PENDING_MEMORY_PATH} into its proposal sections. */
export function parsePendingMemory(source: string): PendingMemoryProposal[] {
  const body = splitFrontmatter(source).body
  const proposals: PendingMemoryProposal[] = []
  let current: { heading: string; target: string; lines: string[] } | null = null
  for (const line of body.split('\n')) {
    const match = PENDING_HEADING_RE.exec(line.trim())
    if (match !== null) {
      if (current !== null) {
        proposals.push(finishProposal(current))
      }
      current = { heading: line.trim(), target: match[2] ?? '', lines: [] }
      continue
    }
    current?.lines.push(line)
  }
  if (current !== null) {
    proposals.push(finishProposal(current))
  }
  return proposals.filter((proposal) => proposal.target !== '' && proposal.body !== '')
}

function finishProposal(section: {
  heading: string
  target: string
  lines: string[]
}): PendingMemoryProposal {
  return {
    heading: section.heading,
    target: section.target,
    body: section.lines.join('\n').trim(),
  }
}

/**
 * `source` with exactly one proposal section removed — the **first** whose
 * heading line matches — the write-back for both approve and discard.
 * First-only matters: agents are told to head proposals with date + agent +
 * target, so two same-day proposals to one target share a heading, and
 * removing every match would silently discard a proposal that was never
 * applied. Approval separately appends the proposal's body to its target.
 */
export function withoutPendingProposal(source: string, heading: string): string {
  const lines = source.split('\n')
  const result: string[] = []
  let skipping = false
  let removed = false
  for (const line of lines) {
    const isHeading = PENDING_HEADING_RE.test(line.trim())
    if (skipping && isHeading) {
      skipping = false
    }
    if (!skipping && !removed && line.trim() === heading) {
      skipping = true
      removed = true
      continue
    }
    if (!skipping) {
      result.push(line)
    }
  }
  return result.join('\n').replaceAll(/\n{3,}/g, '\n\n')
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

/** The seeded shared facts file. */
export function newSharedFactsSeed(): string {
  return [
    '# Shared facts',
    '',
    'Durable facts and decisions every agent in this vault relies on. One',
    'bullet per fact, updated in place, tagged with confidence and signed:',
    '',
    '- [certain] Example: the vault owner prefers concise replies — assistant, 2026-01-01',
    '',
  ].join('\n')
}

/** The seeded shared session journal. */
export function newSharedLogSeed(): string {
  return [
    '# Agent journal',
    '',
    'One short entry per work session, appended by the agent that ran it —',
    'what happened and what was learned. Newest at the bottom.',
    '',
  ].join('\n')
}

/** Seed the shared memory space (facts + journal) if missing. */
export async function ensureSharedMemoryNotes(generation: number): Promise<void> {
  await createNoteIfAbsent(AGENT_SHARED_FACTS_PATH, newSharedFactsSeed(), generation)
  await createNoteIfAbsent(AGENT_SHARED_LOG_PATH, newSharedLogSeed(), generation)
}
