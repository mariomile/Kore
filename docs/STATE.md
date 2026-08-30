# Kore working state

**Updated:** 2026-08-30 at `029f728f` (v0.34.0).
**Rule:** Every session that moves the program updates this file before its
summary: tick what became true and how it was verified, set the next step,
refresh the date. What is done and what is next live here and only here. Why
things are built this way lives in [docs/decisions/](decisions/); what the
product is lives in the [roadmap](roadmap.md) (app-first) with the Personal OS
direction in [Plan 25](plans/25-personal-os.md). The full shipped history stays
in the [delivery log](delivery-log.md); this file tracks only the active work.

## Current focus

**Roadmap "Now" item 1: MCP in read-only chat behind explicit approval.**
Outcome: "search my mail" in a normal chat via the user's configured MCP
servers, with zero-egress remaining the default. Per the 2026-08-30 app-first
decision, the Personal OS foundations (S1/S2/S3) are deferred to Next; see the
[roadmap](roadmap.md) for the full Now/Next/Later ladder.

## What is true now

- [x] **Now item 1 implemented: MCP tools in read-only chat**
  ([Plan 27](plans/27-read-mode-mcp-tools.md)). Composer Tools toggle (Claude
  Code/Codex with at least one enabled server), confirmation dialog naming the
  servers, per-conversation ephemeral opt-in reset by New chat and
  conversation switch, delivery gate `allowEdits || (chatTools &&
  cliProviderSupportsMcp)`, prompt lines naming the servers, privacy.md
  updated. Verified: 42 core CLI tests and 28 chat-provider browser tests pass
  on chromium and webkit; `pnpm check` exit 0. Not yet exercised against a
  live MCP server in the running app.

- [x] App-first reprioritization decided with the user (grilling session,
  2026-08-30) and recorded in the roadmap: Now = read-mode MCP, chat
  attachments off base64 + budget measurement, agent memory recall/skills;
  Next = device-pass session, minimal S3, Connections program; Later = the
  rest of the Personal OS program, intact and decision-gated.
- [x] S4 re-scoped by decision: no first-party universal-search subsystem; the
  agent is the query planner over capabilities. Recorded in roadmap and Plan 25
  I12/I13 notes.
- [x] Planning docs restructured: roadmap rewritten (app-first Now/Next/Later,
  risk register R1–R13), shipped history moved to the delivery log, Plan 26
  gains the S1a/S1b split and the Google restricted-scope risk. Verified: all
  relative links in the touched docs resolve; `pnpm check` exit 0.
- [x] Plan 26's starting-point facts re-verified at `029f728f`: no stable Graph
  ID, no `ConnectorDefinition`/`GraphConnectionGrant`/`email.search` symbols in
  `packages/core` or `src-tauri`. Nothing of S1 is implemented.
- [x] Two S3-relevant facts verified in source: the desktop process survives
  window close (`prevent_exit`, `apps/desktop/src-tauri/src/lib.rs:536`) and
  agent CLI processes spawn from Rust (`apps/desktop/src-tauri/src/agent_cli.rs`).

## Next step

1. **Live check of Now item 1**: with a real MCP server configured, flip the
   Tools toggle in a read-only conversation and watch the agent call it (and
   confirm a fresh conversation is back to zero-egress).
2. **Now item 2**: chat image attachments out of base64, closing with the
   one-time memory-budget measurement on the current build.

## Session log

- 2026-08-30 — Implemented Plan 27 (MCP tools in read-only chat) behind the
  per-conversation Tools opt-in; privacy.md updated; tests green on both
  browser engines.
- 2026-08-30 — Grilling session with the user: app-first decided; S1/S2/S3
  deferred to Next; mobile confirmed as capture/read companion (remote control
  later); semantic search desktop-only; S5 stays later; agent memory work
  scoped to recall + skills; first item = read-mode MCP with approval.
  Roadmap rewritten as Now/Next/Later.
- 2026-08-30 — S4 re-scoped by decision: no first-party universal-search
  subsystem; the agent is the query planner over capabilities, I12's Resource
  store dropped (sync cursors survive, deferred to I16), R11 resolved.
- 2026-08-30 — Roadmap/spec review and doc restructure; risk register added.
  No application code changed.
