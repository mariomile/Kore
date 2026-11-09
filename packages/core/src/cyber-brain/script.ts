import { z } from 'zod'
import { errorMessage } from '../errors'
import { call } from '../ipc/invoke'
import type { CyberBrainConfig } from './config'

/**
 * Memory writes through the vault's own kit script (Plan 34). Kore never
 * re-implements cyber-brain's formats: every write runs the vault's
 * `brain.mjs`, the same code Claude Code and the nightly `dream` run, so a
 * fact, a loop or a decision lands identically whoever wrote it, with its
 * run record and commit. This module is the policy half: which subcommands
 * Kore may run and how their argv is spelled. The Rust half
 * (`kit_script_run`) only spawns Node on a script inside the graph.
 */

/** One memory operation, as the kit's CLI takes it (`brain.mjs --help`). */
export type BrainCommand =
  | {
      readonly kind: 'remember'
      /** What is kept: a fact, an identity block, an observation, or an agent lesson. */
      readonly memory: 'fact' | 'block' | 'observation' | 'lesson'
      readonly text: string
      /** Where it came from; the kit requires it for everything but a lesson. */
      readonly source?: string
      /** The note it belongs in (or `NOW`/`SOUL`/`USER` for a block). */
      readonly target?: string
      /** The line this one replaces, kept as `was:`. */
      readonly replaces?: string
      readonly since?: string
      /** The user asked to write it now, even when the brain queues writes. */
      readonly now?: boolean
    }
  | {
      readonly kind: 'loop-open'
      readonly title: string
      readonly owner?: string
      readonly due?: string
      readonly resurface?: string
      readonly state?: string
      readonly context?: string
      readonly status?: 'open' | 'waiting-user'
    }
  | {
      readonly kind: 'loop-update'
      readonly id: string
      readonly state?: string
      readonly status?: 'open' | 'waiting-user' | 'closed'
      readonly resurface?: string
      readonly owner?: string
    }
  | { readonly kind: 'loop-close'; readonly id: string; readonly outcome: string }
  | {
      readonly kind: 'decision'
      readonly title: string
      readonly description: string
      readonly decision: string
      readonly context?: string
      readonly options?: string
      readonly tradeoffs?: string
    }
  | { readonly kind: 'facts'; readonly query: string; readonly at?: string }
  | { readonly kind: 'check' }

/** Who runs the command: the agent slug signs the run record. */
export interface BrainCaller {
  readonly agent: string
  /** `user` when the user asked for it, else the scheduling agent. */
  readonly by?: string
}

/**
 * An agent slug as the kit's files use it (`System/memory/inbox/<agent>/`):
 * lowercase letters, digits and dashes, so a name can never become a path.
 */
export function brainAgentSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug === '' ? 'kore' : slug
}

/**
 * `--key=value`, always inline: the kit's parser takes a separate argument
 * starting with `--` as the next flag, and an inline value is never
 * re-read as one, so text can't smuggle an option in.
 */
function option(key: string, value: string | undefined): string[] {
  return value === undefined ? [] : [`--${key}=${value}`]
}

function flag(key: string, on: boolean | undefined): string[] {
  return on === true ? [`--${key}`] : []
}

/** The exact argv for one command. Pure: the whole policy is visible here. */
export function brainArgv(command: BrainCommand, caller: BrainCaller): string[] {
  const signed = [
    ...option('agent', brainAgentSlug(caller.agent)),
    ...option('by', caller.by === undefined ? undefined : brainAgentSlug(caller.by)),
  ]
  switch (command.kind) {
    case 'remember':
      return [
        'remember',
        ...signed,
        ...option('kind', command.memory),
        ...option('text', command.text),
        ...option('source', command.source),
        ...option('target', command.target),
        ...option('replaces', command.replaces),
        ...option('since', command.since),
        ...flag('now', command.now),
      ]
    case 'loop-open':
      return [
        'loop',
        'open',
        ...signed,
        ...option('title', command.title),
        ...option('owner', command.owner),
        ...option('due', command.due),
        ...option('resurface', command.resurface),
        ...option('state', command.state),
        ...option('context', command.context),
        ...option('status', command.status),
      ]
    case 'loop-update':
      return [
        'loop',
        'update',
        ...signed,
        ...option('id', command.id),
        ...option('state', command.state),
        ...option('status', command.status),
        ...option('resurface', command.resurface),
        ...option('owner', command.owner),
      ]
    case 'loop-close':
      return [
        'loop',
        'close',
        ...signed,
        ...option('id', command.id),
        ...option('outcome', command.outcome),
      ]
    case 'decision':
      return [
        'decision',
        'new',
        ...signed,
        ...option('title', command.title),
        ...option('description', command.description),
        ...option('decision', command.decision),
        ...option('context', command.context),
        ...option('options', command.options),
        ...option('tradeoffs', command.tradeoffs),
      ]
    case 'facts':
      // The query is positional; `--` would be read as a flag, so a query
      // that starts with dashes is searched without them.
      return ['facts', command.query.replace(/^-+/, ''), ...option('at', command.at)]
    case 'check':
      return ['check', '--json']
  }
}

const kitOutcomeSchema = z.object({
  code: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
})

/** What a command did, in the kit's own words. */
export type BrainResult =
  | {
      readonly ok: true
      /** The kit's summary line(s): what was stored, queued or found. */
      readonly output: string
      /** The commit the kit made, when the brain commits (`git: true`). */
      readonly commit: string | null
    }
  | { readonly ok: false; readonly error: string }

const COMMIT_RE = /\(commit ([0-9a-f]{4,40})\)\s*$/m

/** Turn the script's exit into a result. The kit exits 2 on a refusal. */
export function brainResult(outcome: z.infer<typeof kitOutcomeSchema>): BrainResult {
  if (outcome.timedOut) {
    return { ok: false, error: 'The memory script did not finish in time.' }
  }
  if (outcome.code !== 0) {
    const lines = outcome.stderr.trim().split('\n')
    const last = (lines.findLast((line) => line.trim() !== '') ?? '').replace(/^error:\s*/, '')
    return {
      ok: false,
      error: last === '' ? `The memory script exited with code ${outcome.code ?? '?'}.` : last,
    }
  }
  const output = outcome.stdout.trim()
  return { ok: true, output, commit: COMMIT_RE.exec(output)?.[1] ?? null }
}

/**
 * Run one memory command through the vault's kit script, in the graph open
 * at `generation`. Never throws for a refusal or a missing Node: the caller
 * (a chat tool, MCP) relays the kit's own message.
 */
export async function runBrainCommand(
  config: CyberBrainConfig,
  command: BrainCommand,
  caller: BrainCaller,
  generation: number,
): Promise<BrainResult> {
  try {
    const outcome = await call(
      'kit_script_run',
      { script: config.scriptPath, args: brainArgv(command, caller), generation },
      kitOutcomeSchema,
    )
    return brainResult(outcome)
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}
