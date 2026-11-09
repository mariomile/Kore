import { z } from 'zod'
import { readNote } from '../graph/commands'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'

/**
 * cyber-brain (Plan 34): the user's own kit that turns a vault into a memory
 * every agent shares. A vault opts in by declaring it in the frontmatter of
 * its agent contract, `AGENTS.md` (`cyber_brain: "0.1"`); that frontmatter is
 * the kit's whole configuration (its `System/SPEC.md` §3.1). Kore reads it,
 * never writes it, and never keeps a copy: the vault stays the authority.
 */

/** The only file a cyber-brain vault declares itself in. */
export const CYBER_BRAIN_CONTRACT_PATH = 'AGENTS.md'

/** Where the kit's own files live when `paths.system` is not set (§2). */
const DEFAULT_SYSTEM_PATH = 'System'
const DEFAULT_INBOX_PATH = '_inbox'
const DEFAULT_DAILY_HEADING = '### Agents'

/**
 * A vault-relative folder path the kit may own: forward slashes, no leading
 * slash, no empty, `.` or `..` segment. Anything else is rejected so a
 * mangled config can never point Kore outside the vault.
 */
export function isSafeVaultFolder(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\')) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

const folderSchema = z.string().trim().refine(isSafeVaultFolder)

const configSchema = z.object({
  cyber_brain: z.union([z.string(), z.number()]).transform(String),
  owner: z.string().optional().catch(undefined),
  language: z.string().optional().catch(undefined),
  writers: z.enum(['inbox', 'direct']).catch('inbox').default('inbox'),
  git: z.boolean().catch(false).default(false),
  daily_notes: z.string().trim().catch('').default(''),
  daily_heading: z
    .string()
    .trim()
    .min(1)
    .catch(DEFAULT_DAILY_HEADING)
    .default(DEFAULT_DAILY_HEADING),
  link_style: z.enum(['wikilink', 'markdown']).catch('wikilink').default('wikilink'),
  sensitivity_default: z
    .enum(['private', 'personal', 'shareable'])
    .catch('personal')
    .default('personal'),
  agents: z.array(z.string()).catch([]).default([]),
  paths: z
    .object({
      system: folderSchema.catch(DEFAULT_SYSTEM_PATH).default(DEFAULT_SYSTEM_PATH),
      inbox: folderSchema.catch(DEFAULT_INBOX_PATH).default(DEFAULT_INBOX_PATH),
    })
    .catch({ system: DEFAULT_SYSTEM_PATH, inbox: DEFAULT_INBOX_PATH })
    .default({ system: DEFAULT_SYSTEM_PATH, inbox: DEFAULT_INBOX_PATH }),
  content: z.record(z.string(), folderSchema).catch({}).default({}),
})

/** A vault's cyber-brain configuration, as its `AGENTS.md` declares it. */
export interface CyberBrainConfig {
  /** The kit version the vault runs (`cyber_brain:`), e.g. `0.1`. */
  readonly version: string
  readonly owner: string | null
  /** Language of content; structure is always English. */
  readonly language: string | null
  /** `inbox`: facts wait in transit for `dream`; `direct`: they land at once. */
  readonly writers: 'inbox' | 'direct'
  /** The kit commits its receipts when true. */
  readonly git: boolean
  /** Daily note pattern with `YYYY`/`MM`/`DD` tokens, or null when the brain has none. */
  readonly dailyNotes: string | null
  /** Heading the run summaries go under in a daily note. */
  readonly dailyHeading: string
  readonly linkStyle: 'wikilink' | 'markdown'
  readonly sensitivityDefault: 'private' | 'personal' | 'shareable'
  /** Slugs of the agents that write here. */
  readonly agents: readonly string[]
  /** The kit's own folder (`System/` by default). */
  readonly systemPath: string
  /** The capture folder (`_inbox/` by default). */
  readonly inboxPath: string
  /** Destinations for triage and `remember` (`projects`, `people`, …). */
  readonly content: Readonly<Record<string, string>>
  /** The vault's own kit script, the one implementation of every memory write. */
  readonly scriptPath: string
}

/**
 * The cyber-brain configuration in an `AGENTS.md` source, or null when the
 * file does not declare one (no `cyber_brain:` key), is private, or its
 * frontmatter is not readable. Tolerant like every frontmatter read: a bad
 * field falls back to the kit's default rather than disabling the brain.
 */
export function parseCyberBrainConfig(source: string): CyberBrainConfig | null {
  const raw = splitFrontmatter(source).raw
  const parsed = parseFrontmatter(raw)
  if (parsed.warning !== undefined || parsed.data.private) return null
  const result = configSchema.safeParse(parsed.data)
  if (!result.success || result.data.cyber_brain.trim() === '') return null
  const config = result.data
  return {
    version: config.cyber_brain.trim(),
    owner: config.owner ?? null,
    language: config.language ?? null,
    writers: config.writers,
    git: config.git,
    dailyNotes: config.daily_notes === '' ? null : config.daily_notes,
    dailyHeading: config.daily_heading,
    linkStyle: config.link_style,
    sensitivityDefault: config.sensitivity_default,
    agents: config.agents,
    systemPath: config.paths.system,
    inboxPath: config.paths.inbox,
    content: config.content,
    scriptPath: `${config.paths.system}/scripts/brain.mjs`,
  }
}

/** The open vault's cyber-brain configuration, or null when it runs none. */
export async function loadCyberBrainConfig(): Promise<CyberBrainConfig | null> {
  let source: string
  try {
    source = await readNote(CYBER_BRAIN_CONTRACT_PATH)
  } catch {
    return null
  }
  return parseCyberBrainConfig(source)
}

/**
 * The daily note path for `date` (`YYYY-MM-DD`) under the brain's
 * `daily_notes` pattern, or null when the brain keeps no daily notes or the
 * date is not shaped like one.
 */
export function cyberBrainDailyPath(config: CyberBrainConfig, date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (config.dailyNotes === null || match === null) return null
  const [, year, month, day] = match as unknown as [string, string, string, string]
  return config.dailyNotes.replaceAll('YYYY', year).replaceAll('MM', month).replaceAll('DD', day)
}
