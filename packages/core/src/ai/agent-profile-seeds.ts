/**
 * Seed contents for the agent files under `agents/` — the starting-point
 * markdown written when a profile or shared memory file is first created.
 * The creation flows themselves live in `./agent-profiles`.
 */

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
