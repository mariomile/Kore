import {
  CYBER_BRAIN_TRANSIT_KINDS,
  collapseOneLine,
  findCyberBrainSecret,
  formatCyberBrainRunRecord,
  formatCyberBrainTransit,
  matchMemoryExclusion,
  parseMemoryExclusions,
  type CyberBrainTransitKind,
} from '@kore/core/cyber-brain/format'
import { parseFrontmatter, splitFrontmatter } from '@kore/core/markdown/frontmatter'
import type { Caller } from './caller'
import type { NoteStore } from './store'

const WRITE_ATTEMPTS = 3

function isSafeFolder(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\')) {
    return false
  }
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * The cyber-brain system folder (`System` by default) when `AGENTS.md`
 * declares `cyber_brain:`, or null when the vault does not use cyber-brain.
 */
export async function cyberBrainSystemPath(store: NoteStore): Promise<string | null> {
  const contract = await store.get('AGENTS.md')
  if (contract === null) {
    return null
  }
  const parsed = parseFrontmatter(splitFrontmatter(contract.source).raw)
  if (parsed.warning !== undefined || parsed.data.private) {
    return null
  }
  const version = parsed.data['cyber_brain']
  if (
    (typeof version !== 'string' && typeof version !== 'number') ||
    String(version).trim() === ''
  ) {
    return null
  }
  const paths = parsed.data['paths']
  if (
    paths !== null &&
    typeof paths === 'object' &&
    !Array.isArray(paths) &&
    typeof (paths as Record<string, unknown>)['system'] === 'string'
  ) {
    const candidate = ((paths as Record<string, unknown>)['system'] as string).trim()
    if (isSafeFolder(candidate)) {
      return candidate
    }
  }
  return 'System'
}

function agentSlug(name: string | null): string {
  if (name === null) {
    return 'kore-cloud'
  }
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug === '' ? 'kore-cloud' : slug
}

/** Create or append a line/block to `path` with optimistic concurrency retry. */
async function appendOrCreate(
  store: NoteStore,
  path: string,
  initial: string,
  append: (existing: string) => string,
  author: string | null,
  guardSource: (source: string) => void,
  refuse: (message: string) => never,
): Promise<void> {
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
    const current = await store.get(path)
    const next = current === null ? append(initial) : append(current.source)
    guardSource(next)
    const outcome = await store.write({
      path,
      source: next,
      baseVersion: current?.version ?? 0,
      author,
    })
    if (outcome.status === 'ok') {
      return
    }
  }
  refuse(`${path} kept changing while writing. Try again.`)
}

export interface CyberBrainRememberArgs {
  readonly text: string
  readonly source: string
  readonly kind?: string
  readonly target?: string
  readonly replaces?: string
  readonly since?: string
}

/** Queue one cyber-brain memory item into transit + run record in Kore Cloud. */
export async function queueCyberBrainMemory(
  store: NoteStore,
  args: CyberBrainRememberArgs,
  caller: Caller,
  guardSource: (source: string) => void,
  refuse: (message: string) => never,
): Promise<{ path: string; queued: true; since: string; runLogged: boolean }> {
  const system = await cyberBrainSystemPath(store)
  if (system === null) {
    refuse('This vault has no cyber-brain contract (`cyber_brain:` in AGENTS.md).')
  }
  const rawKind = args.kind ?? 'fact'
  if (!CYBER_BRAIN_TRANSIT_KINDS.includes(rawKind as CyberBrainTransitKind)) {
    refuse(`\`kind\` must be one of ${CYBER_BRAIN_TRANSIT_KINDS.join(', ')}`)
  }
  const kind = rawKind as CyberBrainTransitKind
  if (args.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args.since)) {
    refuse('`since` must be YYYY-MM-DD')
  }
  const payload = `${args.text} ${args.source} ${args.replaces ?? ''} ${args.target ?? ''}`
  const secret = findCyberBrainSecret(payload)
  if (secret !== null) {
    refuse(`Refused: looks like a secret (${secret}). Secrets are never stored in memory.`)
  }
  const exclusionsNote = await store.get(`${system}/memory/exclusions.md`)
  if (exclusionsNote !== null) {
    const exclusions = parseMemoryExclusions(splitFrontmatter(exclusionsNote.source).body)
    const matched = matchMemoryExclusion(payload, exclusions)
    if (matched !== null) {
      refuse(`Refused: matches exclusion "${matched.topic}" in ${system}/memory/exclusions.md.`)
    }
  }
  const now = new Date()
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const today = iso.slice(0, 10)
  const month = iso.slice(0, 7)
  const since = args.since ?? today
  const slug = agentSlug(caller.agent)
  const entry = formatCyberBrainTransit({
    kind,
    text: args.text,
    ...(args.target !== undefined ? { target: args.target } : {}),
    source: args.source,
    since,
    ...(args.replaces !== undefined ? { replaces: args.replaces } : {}),
  })
  const transitPath = `${system}/memory/inbox/${slug}/${today}.md`
  const runPath = `${system}/runs/${month}.md`
  const runHeader = `---\ndescription: Run log for ${month}, one record per agent run with the exact lines written.\nsensitivity: personal\n---\n# Runs ${month}\n`
  const runRecord = formatCyberBrainRunRecord({
    iso,
    agent: slug,
    skill: 'remember',
    summary: `queued ${kind}: ${collapseOneLine(args.text).slice(0, 120)}`,
    writes: [`${transitPath} | (none) | ${entry}`],
  })

  // Pre-validate the run log write against size/privacy limits before writing
  // the transit file, so an oversized or private run log fails cleanly before
  // any memory is queued.
  const currentRun = await store.get(runPath)
  const previewRun = `${(currentRun?.source ?? runHeader).replace(/\s*$/, '\n')}\n${runRecord}\n`
  guardSource(previewRun)

  await appendOrCreate(
    store,
    transitPath,
    `# Transit ${today}\n`,
    (existing) => {
      if (existing.split(/\r?\n/).includes(entry)) {
        return existing
      }
      return `${existing.replace(/\s*$/, '\n')}${entry}\n`
    },
    caller.agent,
    guardSource,
    refuse,
  )

  // The memory is already safely queued in transit. If the run log hits a
  // transient race or limit afterwards, fail soft and report `runLogged: false`
  // rather than throwing an error that would cause callers to retry.
  let runLogged = true
  try {
    await appendOrCreate(
      store,
      runPath,
      runHeader,
      (existing) => `${existing.replace(/\s*$/, '\n')}\n${runRecord}\n`,
      caller.agent,
      guardSource,
      refuse,
    )
  } catch {
    runLogged = false
  }
  return { path: transitPath, queued: true, since, runLogged }
}
