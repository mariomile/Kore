import { z } from 'zod'
import { getBridge, type Unlisten } from '../ipc/bridge'
import { call } from '../ipc/invoke'

/**
 * Bindings for the native minimal durable runtime under agent runs (TDR
 * 0007): the process-wide run lock, the single in-flight routine marker
 * recovery reads on the next launch, and the native scheduler tick. Policy
 * (dueness, retries, degradation when a host lacks these commands) lives in
 * the callers; each binding is the plain typed command.
 */

const voidSchema = z.null()

/**
 * Take the process-wide agent run lease, waiting behind whoever holds it.
 * Resolves with the lease id for {@link releaseAgentRunLease}.
 */
export async function acquireAgentRunLease(): Promise<number> {
  return await call('agent_run_lock_acquire', {}, z.number())
}

/** Release a lease taken by {@link acquireAgentRunLease}. Idempotent. */
export async function releaseAgentRunLease(leaseId: number): Promise<void> {
  await call('agent_run_lock_release', { leaseId }, voidSchema)
}

/**
 * Drop every lease this window holds or waits on. The desktop bootstrap
 * calls it once per JS context: a reloaded webview cannot release its
 * predecessor's leases, and without the sweep the lock stays wedged until
 * the window closes.
 */
export async function resetAgentRunLeases(): Promise<void> {
  await call('agent_run_lock_reset', {}, voidSchema)
}

export const inflightRoutineRunSchema = z
  .object({
    routineId: z.string(),
    startedMs: z.number(),
  })
  .nullable()

export type InflightRoutineRun = NonNullable<z.infer<typeof inflightRoutineRunSchema>>

/**
 * Durably record that a routine run is in flight for the pinned graph —
 * written before the engine starts, so a process death mid-run leaves the
 * marker for the next launch to recover.
 */
export async function markRoutineRunStarted(
  generation: number,
  routineId: string,
  startedMs: number,
): Promise<void> {
  await call('routine_run_mark_started', { generation, routineId, startedMs }, voidSchema)
}

/** Clear the in-flight slot: the run settled (success, failure, or stop). */
export async function markRoutineRunFinished(): Promise<void> {
  await call('routine_run_mark_finished', {}, voidSchema)
}

/**
 * The in-flight marker a previous process left for this graph, or null.
 * Non-null means that run never settled — the process died under it.
 */
export async function inflightRoutineRun(generation: number): Promise<InflightRoutineRun | null> {
  return await call('routine_run_inflight', { generation }, inflightRoutineRunSchema)
}

/**
 * The native scheduler tick: emitted every minute by the Rust shell for the
 * life of the process. The routines runner treats it exactly like its own
 * interval firing — the native side keeps ticking when a hidden window's JS
 * timers are throttled under App Nap.
 */
export const NATIVE_ROUTINE_TICK_EVENT = 'agent-routines:native-tick'

/** Subscribe to {@link NATIVE_ROUTINE_TICK_EVENT}; resolves with unlisten. */
export function subscribeNativeRoutineTick(handler: () => void): Promise<Unlisten> {
  return getBridge().listen(NATIVE_ROUTINE_TICK_EVENT, () => {
    handler()
  })
}
