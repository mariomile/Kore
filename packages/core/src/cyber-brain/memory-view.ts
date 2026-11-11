import { z } from 'zod'
import { listFiles, readNote } from '../graph/commands'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import type { CyberBrainConfig } from './config'
import { runBrainCommand } from './script'

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
  /** ISO time from the record's heading. */
  readonly at: string
  readonly agent: string
  readonly skill: string
  readonly outcome: string
  readonly summary: string
  readonly commit: string | null
  readonly writes: readonly MemoryRunWrite[]
}

export interface MemoryOverview {
  /** `identity/NOW.md`, body only; null when missing or private. */
  readonly now: { readonly path: string; readonly body: string } | null
  /** Loops not closed, the ones to resurface first. */
  readonly openLoops: readonly MemoryLoop[]
  readonly closedLoops: number
  readonly loopsPath: string
  /** Newest first. */
  readonly decisions: readonly MemoryDecision[]
  /** Newest first, from the latest run files. */
  readonly runs: readonly MemoryRun[]
}

/** Runs the view shows; older ones stay in the files. */
export const MEMORY_RUNS_LIMIT = 50
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
  return text
    .split(/^## (?=\d{4}-\d{2}-\d{2}T)/m)
    .slice(1)
    .map((part) => {
      const lines = part.split(/\r?\n/)
      const [at = '', headerAgent = '', headerSkill = ''] = lines[0]!.trim().split(/\s+/)
      const fields: Record<string, string> = {}
      const writes: MemoryRunWrite[] = []
      for (const line of lines.slice(1)) {
        const match = /^- ([a-z]+):\s*(.*)$/.exec(line)
        if (match === null) continue
        if (match[1] === 'write') writes.push(parseWrite(match[2]!))
        else fields[match[1]!] = match[2]!.trim()
      }
      return {
        at,
        agent: fields['agent'] ?? headerAgent,
        skill: fields['skill'] ?? headerSkill,
        outcome: fields['outcome'] ?? 'ok',
        summary: fields['summary'] ?? '',
        commit: fields['commit'] ?? null,
        writes,
      }
    })
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
  const loopsPath = `${system}/memory/loops.md`
  const decisionsDir = `${system}/memory/decisions/`
  const runsDir = `${system}/runs/`
  const files = await listFiles().catch(() => [])
  const paths = files.map((file) => file.path)
  const decisionPaths = paths
    .filter((path) => path.startsWith(decisionsDir) && path.endsWith('.md'))
    .filter((path) => !path.slice(decisionsDir.length).includes('/'))
  const runPaths = paths
    .filter(
      (path) => /^\d{4}-\d{2}\.md$/.test(path.slice(runsDir.length)) && path.startsWith(runsDir),
    )
    .sort()
    .reverse()
    .slice(0, RUN_MONTHS)

  const [nowBody, loopsBody, decisions, runTexts] = await Promise.all([
    readBody(nowPath),
    readBody(loopsPath),
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
  ])

  const loops = loopsBody === null ? [] : parseMemoryLoops(loopsBody)
  const openLoops = loops
    .filter((loop) => loop.status !== 'closed')
    .sort((a, b) => (a.resurface ?? '9999').localeCompare(b.resurface ?? '9999'))
  const runs = runTexts
    .flatMap((text) => (text === null ? [] : parseMemoryRuns(text)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MEMORY_RUNS_LIMIT)

  return {
    now: nowBody === null || nowBody.trim() === '' ? null : { path: nowPath, body: nowBody.trim() },
    openLoops,
    closedLoops: loops.length - openLoops.length,
    loopsPath,
    decisions: decisions
      .filter((decision): decision is MemoryDecision => decision !== null)
      .sort((a, b) => b.path.localeCompare(a.path)),
    runs,
  }
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
