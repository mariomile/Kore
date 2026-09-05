import { z } from 'zod'
import { call } from '../ipc/invoke'

/**
 * Script-mode routine ticks (bb's silent tick): a routine may carry a shell
 * script that runs deterministically at each occurrence, before any model
 * wakes. The contract:
 *
 * - exit 0 with empty output, or `{"wakeAgent": false}` on stdout → the
 *   tick is recorded as **skipped** and no agent runs — a routine that
 *   checks "anything to do?" costs zero tokens on quiet days;
 * - exit 0 with other output → the agent runs, with the output attached to
 *   its prompt as data (what changed, what to look at);
 * - non-zero exit or timeout → a failed run, feeding the routine's normal
 *   retry/backoff/pause machinery.
 */

const scriptTickOutcomeSchema = z.object({
  /** Exit code, or null when the process was killed (timeout included). */
  code: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
})
export type ScriptTickOutcome = z.infer<typeof scriptTickOutcomeSchema>

/** One tick's worth of patience — scripts are checks, not jobs. */
export const ROUTINE_SCRIPT_TIMEOUT_MS = 30_000

/** Run one routine script in the graph root, output capped Rust-side. */
export async function runRoutineScriptTick(
  script: string,
  generation: number,
  signal: AbortSignal,
): Promise<ScriptTickOutcome> {
  signal.throwIfAborted()
  const requestId = crypto.randomUUID()
  await call('routine_script_prepare', { requestId }, z.null())
  const cancellation: { stopping: Promise<void> | null } = { stopping: null }
  const stop = (): void => {
    cancellation.stopping ??= call('routine_script_stop', { requestId }, z.null()).then(() => {})
    // The rejection is joined below, after the run settles.
    void cancellation.stopping.catch(() => {})
  }
  signal.addEventListener('abort', stop, { once: true })
  try {
    if (signal.aborted) {
      stop()
      await cancellation.stopping
    }
    const outcome = await call(
      'routine_script_run',
      { requestId, command: script, generation, timeoutMs: ROUTINE_SCRIPT_TIMEOUT_MS },
      scriptTickOutcomeSchema,
    )
    signal.throwIfAborted()
    return outcome
  } finally {
    signal.removeEventListener('abort', stop)
    await cancellation.stopping
  }
}

export type ScriptTickDecision =
  | { kind: 'skip' }
  | { kind: 'wake'; context: string }
  | { kind: 'fail'; message: string }

/** Interpret one script outcome per the silent-tick contract above. */
export function decideScriptTick(outcome: ScriptTickOutcome): ScriptTickDecision {
  if (outcome.timedOut) {
    return { kind: 'fail', message: 'The routine script timed out.' }
  }
  if (outcome.code !== 0) {
    const tail = outcome.stderr.trim().split('\n').slice(-3).join('\n').trim()
    return {
      kind: 'fail',
      message:
        `The routine script exited with code ${outcome.code ?? 'unknown'}.` +
        (tail === '' ? '' : `\n${tail}`),
    }
  }
  const output = outcome.stdout.trim()
  if (output === '') {
    return { kind: 'skip' }
  }
  try {
    const parsed: unknown = JSON.parse(output)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as { wakeAgent?: unknown }).wakeAgent === false
    ) {
      return { kind: 'skip' }
    }
  } catch {
    // Not JSON — plain context for the agent.
  }
  return { kind: 'wake', context: output }
}
