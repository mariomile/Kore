import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import { listFiles, readNote } from '../graph/commands'

/**
 * Vault skills (roadmap Now item 3b): reusable procedures the user teaches,
 * one markdown file each under `agents/skills/`. Richer than the app's
 * single managed CLI skill file (`app/agent-skill.ts` installs that one):
 * these are the *user's* skills — "save this as a skill" turns a refined
 * workflow into a file any later session can follow.
 *
 * Progressive disclosure, same philosophy as memory digests: the prompt
 * carries only the catalog — name, one-line description, path — and the
 * agent reads a skill's body when a task matches it. Plain markdown in the
 * graph, so skills are visible, editable, linkable, synced, versioned —
 * and `private: true` hides one from every prompt, the built-in off
 * switch. Under write approval, a new or changed skill goes through the
 * same pending-proposal queue as memory (R7: user-reviewed, never a
 * silent durable instruction).
 */

/** The vault directory user-taught skills live under. */
export const AGENT_SKILLS_DIR = 'agents/skills'

/** Graph-relative path of one skill file. */
export function agentSkillPath(slug: string): string {
  return `${AGENT_SKILLS_DIR}/${slug}.md`
}

/** Most skills the prompt catalog lists (token budget; A→Z wins past it). */
export const VAULT_SKILLS_MAX = 30

/** Cap on one catalog description line. */
export const VAULT_SKILL_DESCRIPTION_MAX_CHARS = 200

export interface VaultSkill {
  /** File name under `agents/skills/`, without `.md`. */
  slug: string
  path: string
  /** Display name: the file's H1, or the slug when it has none. */
  name: string
  /** One line on when to use it: frontmatter `description`, or empty. */
  description: string
}

const SKILL_PATH_RE = /^agents\/skills\/([^/]+)\.md$/

function firstHeading(body: string): string | null {
  for (const line of body.split('\n')) {
    const match = /^#\s+(.+)$/.exec(line.trim())
    if (match !== null) {
      return match[1]!.trim()
    }
  }
  return null
}

/**
 * The graph's skill catalog, A→Z by slug, capped at {@link VAULT_SKILLS_MAX}.
 * A private, empty, or unreadable skill file is skipped — listing never
 * throws, so loading a prompt context can't be blocked by one bad file.
 */
export async function listVaultSkills(): Promise<VaultSkill[]> {
  let slugs: string[]
  try {
    const files = await listFiles()
    slugs = files
      .map((file) => SKILL_PATH_RE.exec(file.path)?.[1])
      .filter((slug): slug is string => slug !== undefined)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, VAULT_SKILLS_MAX)
  } catch {
    return []
  }
  const skills: VaultSkill[] = []
  for (const slug of slugs) {
    const path = agentSkillPath(slug)
    try {
      const source = await readNote(path)
      const split = splitFrontmatter(source)
      const frontmatter = parseFrontmatter(split.raw).data
      if (frontmatter.private) {
        continue
      }
      const body = split.body.trim()
      if (body === '') {
        continue
      }
      const description =
        typeof frontmatter['description'] === 'string'
          ? frontmatter['description'].trim().slice(0, VAULT_SKILL_DESCRIPTION_MAX_CHARS)
          : ''
      skills.push({ slug, path, name: firstHeading(body) ?? slug, description })
    } catch {
      // Unreadable skill: the catalog goes out without it.
    }
  }
  return skills
}

/**
 * The catalog block for the system prompt: one line per skill, body left in
 * the file — the agent reads it when a task matches. Empty when the graph
 * has no skills: no block, no noise.
 */
export function vaultSkillsPromptLines(skills: VaultSkill[]): string[] {
  if (skills.length === 0) {
    return []
  }
  return [
    '',
    `Skills — reusable procedures the user taught, one file each under ${AGENT_SKILLS_DIR}/. When a task matches one, read its file and follow it; do not guess a skill's steps from its name:`,
    ...skills.map(
      (skill) =>
        `- ${skill.name}${skill.description === '' ? '' : ` — ${skill.description}`} (${skill.path})`,
    ),
  ]
}
