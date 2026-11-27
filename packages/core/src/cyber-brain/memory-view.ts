import { z } from 'zod'
import { listFiles, readNote } from '../graph/commands'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import type { CyberBrainConfig } from './config'
import {
  parseMemoryExclusions,
  parseMemoryTransitFile,
  type MemoryExclusion,
  type MemoryTransitEntry,
} from './format'
import { runBrainCommand, type BrainResult } from './script'

/**
 * The Memory view's data (Plan 35, slice 3): what a cyber-brain vault
 * remembers, read straight from the kit's own files. Nothing is copied or
 * cached: NOW, the open loops, the decisions and the run records are the
 * files every agent writes, so the view shows exactly what the next agent
 * will read. Reading only; writes stay with the kit's script.
 */

/** One loop of `<system>/memory/loops.md` (`## loop-…` plus `- key: value`). */
export interface MemoryLoop {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly opened: string | null
  readonly resurface: string | null
  readonly owner: string | null
  readonly state: string | null
}

/** One decision note under `<system>/memory/decisions/`. */
export interface MemoryDecision {
  readonly path: string
  readonly title: string
  readonly description: string
  /** `YYYY-MM-DD` from the file name, when it starts with one. */
  readonly date: string | null
}

/** One line a run wrote: `path | before | after`. */
export interface MemoryRunWrite {
  readonly path: string
  readonly before: string
  readonly after: string
}

/** One run record of `<system>/runs/YYYY-MM.md`. */
export interface MemoryRun {
  /**
   * The run's name as the kit gives it: the heading, plus ` #n` for the
   * n-th repeat of the same heading (episodes list their runs by it).
   */
  readonly key: string
  /** ISO time from the record's heading. */
  readonly at: string
  readonly agent: string
  readonly skill: string
  readonly outcome: string
  readonly summary: string
  readonly commit: string | null
  /** The episode note this run wrote (`skill: episode`). */
  readonly episode: string | null
  /** What this run reverted (`skill: undo`): an episode path or a run key. */
  readonly undoes: string | null
  readonly writes: readonly MemoryRunWrite[]
}

/** One line of an episode's `## Learned`: the fact and the note it went to. */
export interface MemoryEpisodeFact {
  readonly text: string
  /** The destination note's name, or null when the agent didn't know it. */
  readonly note: string | null
  /** Queued for `dream` rather than written (an inbox brain). */
  readonly queued: boolean
}

/** One working session, as the kit writes it under `paths.episodes` (SPEC 4.6). */
export interface MemoryEpisode {
  readonly path: string
  readonly title: string
  readonly summary: string
  readonly agent: string
  /** ISO times. */
  readonly started: string | null
  readonly ended: string | null
  readonly durationMin: number | null
  /** Names of the notes the session read or changed. */
  readonly touched: readonly string[]
  readonly learned: readonly MemoryEpisodeFact[]
  /** Run keys the episode covers (its own run is found by `episode:`). */
  readonly runKeys: readonly string[]
}

/** An episode with what it changed, as the Memory view shows it. */
export interface MemoryEpisodeEntry extends MemoryEpisode {
  /** Every line its runs wrote, oldest first, outside the kit's own logs. */
  readonly writes: readonly MemoryRunWrite[]
}

export interface MemoryOverview {
  /** `identity/NOW.md`, body only; null when missing or private. */
  readonly now: { readonly path: string; readonly body: string } | null
  /** Paths to `USER.md` and `SOUL.md` when present in the vault. */
  readonly userPath: string | null
  readonly soulPath: string | null
  /** Queued transit entries waiting for `dream` (`memory/inbox/<agent>/*.md`). */
  readonly transit: readonly MemoryTransitEntry[]
  /** Active exclusions from `memory/exclusions.md` (topics never stored/re-imported). */
  readonly exclusions: readonly MemoryExclusion[]
  readonly exclusionsPath: string
  /** Loops not closed, the ones to resurface first. */
  readonly openLoops: readonly MemoryLoop[]
  readonly closedLoops: number
  readonly loopsPath: string
  /** Newest first. */
  readonly decisions: readonly MemoryDecision[]
  /** Newest first, from the latest run files. */
  readonly runs: readonly MemoryRun[]
  /** Newest first: the latest working sessions, with what each changed. */
  readonly episodes: readonly MemoryEpisodeEntry[]
}

/** Runs the view shows; older ones stay in the files. */
export const MEMORY_RUNS_LIMIT = 50
/** Episodes the view shows; older ones stay in their folder. */
export const MEMORY_EPISODES_LIMIT = 40
/** Run files read, newest month first. */
const RUN_MONTHS = 2

function body(source: string): string | null {
  const split = splitFrontmatter(source)
  return parseFrontmatter(split.raw).data.private ? null : split.body
}

/** Parse loops like the kit's `parseLoops` (the kit stays the writer). */
export function parseMemoryLoops(text: string): MemoryLoop[] {
  return text
    .split(/^## (?=loop-)/m)
    .slice(1)
    .map((part) => {
      const lines = part.split(/\r?\n/)
      const fields: Record<string, string> = {}
      for (const line of lines.slice(1)) {
        const match = /^- ([a-z-]+):\s*(.*)$/.exec(line)
        if (match !== null) fields[match[1]!] = match[2]!.trim()
      }
      return {
        id: lines[0]!.trim(),
        title: fields['title'] ?? lines[0]!.trim(),
        status: fields['status'] ?? 'open',
        opened: fields['opened'] ?? null,
        resurface: fields['resurface'] ?? null,
        owner: fields['owner'] ?? null,
        state: fields['state'] ?? null,
      }
    })
}

function parseWrite(text: string): MemoryRunWrite {
  const [path = '', before = '', ...after] = text.split(' | ')
  return { path: path.trim(), before: before.trim(), after: after.join(' | ').trim() }
}

/** Parse run records like the kit's `parseRuns`, newest last as in the file. */
export function parseMemoryRuns(text: string): MemoryRun[] {
  const seen = new Map<string, number>()
  return text
    .split(/^## (?=\d{4}-\d{2}-\d{2}T)/m)
    .slice(1)
    .map((part) => {
      const lines = part.split(/\r?\n/)
      const header = lines[0]!.trim()
      const repeat = (seen.get(header) ?? 0) + 1
      seen.set(header, repeat)
      const [at = '', headerAgent = '', headerSkill = ''] = header.split(/\s+/)
      const fields: Record<string, string> = {}
      const writes: MemoryRunWrite[] = []
      for (const line of lines.slice(1)) {
        const match = /^- ([a-z]+):\s*(.*)$/.exec(line)
        if (match === null) continue
        if (match[1] === 'write') writes.push(parseWrite(match[2]!))
        else fields[match[1]!] = match[2]!.trim()
      }
      return {
        key: repeat > 1 ? `${header} #${repeat}` : header,
        at,
        agent: fields['agent'] ?? headerAgent,
        skill: fields['skill'] ?? headerSkill,
        outcome: fields['outcome'] ?? 'ok',
        summary: fields['summary'] ?? '',
        commit: fields['commit'] ?? null,
        episode: fields['episode'] ?? null,
        undoes: fields['undoes'] ?? null,
        writes,
      }
    })
}

/** `[[Note]]` or `[Note](path)` to the note's name; anything else as is. */
function linkName(link: string): string {
  const trimmed = link.trim()
  const wiki = /^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/.exec(trimmed)
  if (wiki !== null) return wiki[1]!.trim()
  const markdown = /^\[([^\]]+)\]\([^)]*\)$/.exec(trimmed)
  return markdown === null ? trimmed : markdown[1]!.trim()
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string')
  return typeof value === 'string' ? [value] : []
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]
  if (value instanceof Date) return value.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

const LEARNED_RE = /^- (.*?)(?: -> (\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]*\)))?( \(waiting for dream\))?$/

/**
 * Parse an episode note like the kit writes it (`brain.mjs episode`), or
 * null when it isn't one or is private. The kit stays the writer.
 */
export function parseMemoryEpisode(path: string, source: string): MemoryEpisode | null {
  const split = splitFrontmatter(source)
  const data = parseFrontmatter(split.raw).data as Record<string, unknown>
  if (data['private'] === true || data['type'] !== 'episode') return null
  const lines = split.body.split(/\r?\n/)
  const learnedAt = lines.findIndex((line) => /^##\s+Learned\s*$/.test(line))
  const summaryLines = (learnedAt < 0 ? lines : lines.slice(0, learnedAt)).filter(
    (line) => !/^#\s/.test(line),
  )
  const learned: MemoryEpisodeFact[] = []
  for (const line of learnedAt < 0 ? [] : lines.slice(learnedAt + 1)) {
    if (/^##\s/.test(line)) break
    const match = LEARNED_RE.exec(line.trim())
    if (match === null || match[1]!.trim() === '') continue
    learned.push({
      text: match[1]!.trim(),
      note: match[2] === undefined ? null : linkName(match[2]),
      queued: match[3] !== undefined,
    })
  }
  const duration = data['duration_min']
  const name = path.slice(path.lastIndexOf('/') + 1, -'.md'.length)
  return {
    path,
    title: firstHeading(split.body) ?? name,
    summary: summaryLines.join('\n').trim(),
    agent: stringField(data, 'agent') ?? 'agent',
    started: stringField(data, 'started'),
    ended: stringField(data, 'ended'),
    durationMin: typeof duration === 'number' && Number.isFinite(duration) ? duration : null,
    touched: stringList(data['touched']).map(linkName),
    learned,
    runKeys: stringList(data['runs']),
  }
}

/**
 * Join an episode to the runs that wrote it: the lines changed, oldest
 * first, leaving out the episode note itself and the kit's own logs.
 */
export function episodeEntry(
  episode: MemoryEpisode,
  runs: readonly MemoryRun[],
  systemPath: string,
): MemoryEpisodeEntry {
  const keys = new Set(episode.runKeys)
  const own = runs.filter(
    (run) => keys.has(run.key) || (run.skill === 'episode' && run.episode === episode.path),
  )
  const hidden = [`${systemPath}/runs/`, `${systemPath}/archive/`]
  const writes = [...own]
    .sort((a, b) => a.at.localeCompare(b.at))
    .flatMap((run) => run.writes)
    .filter((write) => write.path !== episode.path)
    .filter((write) => !hidden.some((prefix) => write.path.startsWith(prefix)))
  // An undone episode needs no flag: the kit archives its note, so it
  // leaves the list on the next read.
  return { ...episode, writes }
}

/** One changed line of a file, as a diff shows it. */
export interface MemoryChangeLine {
  readonly sign: '+' | '-'
  readonly text: string
}

/** What a set of writes did to one file. */
export interface MemoryFileChange {
  readonly path: string
  readonly lines: readonly MemoryChangeLine[]
  readonly added: number
  readonly removed: number
}

/** `(none)`, `(new file)`, `(archived)`: the kit's markers, not text. */
const isMarker = (value: string): boolean => /^\(.*\)$/.test(value)

/**
 * Group writes by file into diff lines, in file order of first touch: a
 * replaced line is `-` then `+`, an added one `+`, a removed one `-`.
 */
export function memoryFileChanges(writes: readonly MemoryRunWrite[]): MemoryFileChange[] {
  const byPath = new Map<string, MemoryChangeLine[]>()
  for (const write of writes) {
    const lines = byPath.get(write.path) ?? []
    if (!isMarker(write.before) && write.before !== '')
      lines.push({ sign: '-', text: write.before })
    if (!isMarker(write.after) && write.after !== '') lines.push({ sign: '+', text: write.after })
    byPath.set(write.path, lines)
  }
  return [...byPath]
    .filter(([, lines]) => lines.length > 0)
    .map(([path, lines]) => ({
      path,
      lines,
      added: lines.filter((line) => line.sign === '+').length,
      removed: lines.filter((line) => line.sign === '-').length,
    }))
}

function firstHeading(text: string): string | null {
  const match = /^#\s+(.+)$/m.exec(text)
  return match === null ? null : match[1]!.trim()
}

async function readBody(path: string): Promise<string | null> {
  try {
    return body(await readNote(path))
  } catch {
    return null
  }
}

/** Everything the Memory view shows. Missing files read as empty, never fail. */
export async function loadMemoryOverview(config: CyberBrainConfig): Promise<MemoryOverview> {
  const system = config.systemPath
  const nowPath = `${system}/identity/NOW.md`
  const userPath = `${system}/identity/USER.md`
  const soulPath = `${system}/identity/SOUL.md`
  const loopsPath = `${system}/memory/loops.md`
  const exclusionsPath = `${system}/memory/exclusions.md`
  const inboxDir = `${system}/memory/inbox/`
  const decisionsDir = `${system}/memory/decisions/`
  const runsDir = `${system}/runs/`
  const files = await listFiles().catch(() => [])
  const paths = files.map((file) => file.path)
  const pathSet = new Set(paths)
  const decisionPaths = paths
    .filter((path) => path.startsWith(decisionsDir) && path.endsWith('.md'))
    .filter((path) => !path.slice(decisionsDir.length).includes('/'))
  const transitPaths = paths
    .filter((path) => path.startsWith(inboxDir) && path.endsWith('.md'))
    .sort((left, right) => {
      const leftFile = left.slice(left.lastIndexOf('/') + 1)
      const rightFile = right.slice(right.lastIndexOf('/') + 1)
      return rightFile.localeCompare(leftFile) || right.localeCompare(left)
    })
    .slice(0, 20)
  const episodesDir = `${config.episodesPath}/`
  const episodePaths = paths
    .filter((path) => path.startsWith(episodesDir) && path.endsWith('.md'))
    .sort((left, right) => {
      const leftFile = left.slice(left.lastIndexOf('/') + 1)
      const rightFile = right.slice(right.lastIndexOf('/') + 1)
      return rightFile.localeCompare(leftFile) || right.localeCompare(left)
    })
    .slice(0, MEMORY_EPISODES_LIMIT)
  const runPaths = paths
    .filter(
      (path) => /^\d{4}-\d{2}\.md$/.test(path.slice(runsDir.length)) && path.startsWith(runsDir),
    )
    .sort()
    .reverse()
    .slice(0, RUN_MONTHS)

  const [nowBody, loopsBody, exclusionsBody, transitEntries, decisions, runTexts, episodeNotes] =
    await Promise.all([
      readBody(nowPath),
      readBody(loopsPath),
      readBody(exclusionsPath),
      Promise.all(
        transitPaths.map(async (path): Promise<MemoryTransitEntry[]> => {
          const text = await readBody(path)
          if (text === null) return []
          const agent = path.slice(inboxDir.length).split('/')[0] ?? 'agent'
          return parseMemoryTransitFile(path, agent, text)
        }),
      ),
      Promise.all(
        decisionPaths.map(async (path): Promise<MemoryDecision | null> => {
          let source: string
          try {
            source = await readNote(path)
          } catch {
            return null
          }
          const split = splitFrontmatter(source)
          const data = parseFrontmatter(split.raw).data
          if (data.private) return null
          const name = path.slice(decisionsDir.length, -'.md'.length)
          const date = /^(\d{4}-\d{2}-\d{2})/.exec(name)?.[1] ?? null
          return {
            path,
            title: firstHeading(split.body) ?? name,
            description: typeof data['description'] === 'string' ? data['description'].trim() : '',
            date,
          }
        }),
      ),
      Promise.all(runPaths.map(readBody)),
      Promise.all(
        episodePaths.map(async (path) => {
          try {
            return parseMemoryEpisode(path, await readNote(path))
          } catch {
            return null
          }
        }),
      ),
    ])

  const loops = loopsBody === null ? [] : parseMemoryLoops(loopsBody)
  const openLoops = loops
    .filter((loop) => loop.status !== 'closed')
    .sort((a, b) => (a.resurface ?? '9999').localeCompare(b.resurface ?? '9999'))
  const allRuns = runTexts
    .flatMap((text) => (text === null ? [] : parseMemoryRuns(text)))
    .sort((a, b) => b.at.localeCompare(a.at))
  const episodes = episodeNotes
    .filter((episode): episode is MemoryEpisode => episode !== null)
    .map((episode) => episodeEntry(episode, allRuns, system))

  return {
    now: nowBody === null || nowBody.trim() === '' ? null : { path: nowPath, body: nowBody.trim() },
    userPath: pathSet.has(userPath) ? userPath : null,
    soulPath: pathSet.has(soulPath) ? soulPath : null,
    transit: transitEntries.flat(),
    exclusions: exclusionsBody === null ? [] : parseMemoryExclusions(exclusionsBody),
    exclusionsPath,
    openLoops,
    closedLoops: loops.length - openLoops.length,
    loopsPath,
    decisions: decisions
      .filter((decision): decision is MemoryDecision => decision !== null)
      .sort((a, b) => b.path.localeCompare(a.path)),
    runs: allRuns.slice(0, MEMORY_RUNS_LIMIT),
    episodes,
  }
}

/**
 * Undo one episode with the kit (`brain.mjs undo --episode`): it removes
 * the lines the episode wrote, restores the ones it replaced and archives
 * the episode, with its own run record. Kore never edits the files itself.
 */
export function undoEpisode(
  config: CyberBrainConfig,
  path: string,
  generation: number,
): Promise<BrainResult> {
  return runBrainCommand(
    config,
    { kind: 'undo', episode: path },
    { agent: 'kore', by: 'user' },
    generation,
  )
}

const checkSchema = z.object({
  issues: z
    .array(
      z.object({
        level: z.string().catch('info'),
        where: z.string().catch(''),
        msg: z.string().catch(''),
      }),
    )
    .catch([]),
  stats: z.record(z.string(), z.unknown()).catch({}),
})

/** `brain.mjs check`: the kit's own health report. */
export type MemoryHealth =
  | { readonly ok: true; readonly issues: z.infer<typeof checkSchema>['issues'] }
  | { readonly ok: false; readonly error: string }

/** Run the kit's `check` (gated like every kit run: the script must be allowed). */
export async function checkMemoryHealth(
  config: CyberBrainConfig,
  generation: number,
): Promise<MemoryHealth> {
  const result = await runBrainCommand(config, { kind: 'check' }, { agent: 'kore' }, generation)
  if (!result.ok) return result
  try {
    return { ok: true, issues: checkSchema.parse(JSON.parse(result.output)).issues }
  } catch {
    return { ok: false, error: 'The memory check printed something Kore could not read.' }
  }
}
