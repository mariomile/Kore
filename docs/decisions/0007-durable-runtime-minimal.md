# TDR 0007 — Minimal durable runtime under agent runs

**Status:** Accepted; implemented by the change that adds this record.
**Date:** 2026-08-30.
**Delivery:** Roadmap Next → Now by user decision (2026-08-30). This is the
"S3 minimal" slice of [Plan 25](../plans/25-personal-os.md) I07, bounded by
risk R4 in the [roadmap](../roadmap.md): states, attempts, one
runtime-global lock, recovery — and nothing more general.

## Context

Routines executed entirely inside the main window's webview: a
per-JS-context FIFO lock, an in-memory event-run queue, history in the
settings document. Four facts shaped this slice:

- On macOS, closing the main window **hides** it (`quit-flush.ts`), so the
  webview — and the runner — keep living. The gap is not "no execution with
  the window closed"; it is that a hidden window's JS timers throttle (or
  suspend) under App Nap, so schedules could silently stop firing.
- The run lock was per JS context. A chat edit turn in a note window and a
  routine in the main window could overlap, and the activity ledger's
  snapshot/diff would cross-attribute their changes.
- A run killed with the process (⌘Q, crash) vanished: the occurrence was
  consumed (`lastRunMs` is stamped before the run starts, by design), no
  history entry was written, no retry was scheduled.
- Stopping a run was impossible from the UI, even though the native side
  already kills an agent CLI's process tree on request (`agent_cli_stop`).

## Decision

Four primitives land in Rust (`src-tauri/src/runtime.rs`); every policy
stays in `@reflect/core` and the runner:

1. **One process-wide run lock.** FIFO leases tagged with the owning window
   label; a destroyed window's leases are swept, and each fresh JS context
   resets its own window's leases at bootstrap (a reloaded webview cannot
   release its predecessor's). `withAgentRunLock` now composes its local
   tail with the native lease, so chat edit turns and routines serialize
   across every window; hosts without the command (tests, plain-browser
   dev) degrade to the local layer — the entire pre-0007 behavior.
2. **One durable in-flight marker.** `runtime/inflight-routine.json` under
   the app data dir, atomic temp+rename write, recorded before a run's
   engine starts and cleared when it settles. A single slot is correct by
   construction: runs hold the global lock. On the next launch the runner
   turns a leftover marker into an interrupted-run failure entry — visible
   in run history, feeding the existing backoff/pause machinery — once per
   graph root, and only for the marker's own graph.
3. **Cancellation that reaches the worker.** The runner passes an abort
   signal into the engine stream (the transports already wire abort to the
   native kill). The Agents screen shows the run in flight and offers Stop;
   a stopped run records history without a failure strike — a deliberate
   stop is not the routine failing.
4. **A native scheduler tick.** The Rust shell emits a minute tick for the
   life of the process; the runner treats it exactly like its own interval,
   so hidden-window throttling can no longer starve schedules.

## Deliberately out of this slice

- **No job table, no queue generalization (R4).** Clock dueness already
  recovers from settings by design (missed schedules catch up); the
  pending collection-event queue stays in memory, so a webview reload can
  still drop not-yet-started event runs — a bounded, known loss window.
- **No execution without any webview**, and no approval checkpoints (I08):
  those wait for external writes to exist.
- **Interrupted runs count failure strikes.** Three quit-kills in a row
  pause the routine — flap protection; a user Stop deliberately does not.

## Consequences

- Edit-mode runs can no longer cross-attribute ledgers, whichever windows
  they start from; the second run waits, exactly as two runs in one window
  always have.
- A quit mid-run surfaces on relaunch ("interrupted", with retry) instead
  of vanishing.
- The lock is in-process state: a restart clears it (correct — a restart
  has no runs). The marker is the only new durable state, one file.
