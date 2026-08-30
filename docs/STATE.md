# Kore working state

**Updated:** 2026-08-30 at `92220af4` (post-v0.37.1).
**Rule:** Every session that moves the program updates this file before its
summary: tick what became true and how it was verified, set the next step,
refresh the date. What is done and what is next live here and only here. Why
things are built this way lives in [docs/decisions/](decisions/); what the
product is lives in the [roadmap](roadmap.md) (app-first) with the Personal OS
direction in [Plan 25](plans/25-personal-os.md). The full shipped history stays
in the [delivery log](delivery-log.md); this file tracks only the active work.

## Current focus

**Roadmap "Now" item 3: agent memory — recall and reusable skills.** Both
halves are implemented (recall merged in #104, skills in review); what
remains is exercising them against real usage with the user. Per the
2026-08-30 app-first decision, the Personal OS foundations (S1/S2/S3) are
deferred to Next; see the [roadmap](roadmap.md) for the full Now/Next/Later
ladder.

## What is true now

- [x] **Now item 2 implemented: chat attachments out of base64.** Bytes go to
  `.reflect/chat-attachments/<conversation>/` at send time via new
  generation-pinned Rust commands (closed path shape, atomic writes); the
  persisted row keeps only the path; rendering rides a strict carve-out in
  the `reflect-asset://` protocol; BYOK sends hydrate restored attachments
  per send; conversation delete sweeps the directory; legacy inline rows
  still load. Verified: 10 Rust unit tests (validators + protocol carve-out),
  30 core tests, 64 browser tests on chromium (webkit locally green except
  the known pre-existing model-picker flake, which is green on CI with
  retries); `pnpm check` exit 0; `cargo fmt`/`clippy` clean.
- [x] **Now item 2's measurement run.** Native embedding benchmark on the
  current build (bounded mode, 32 texts × 5 cycles, cached model): peak
  native footprint 515 MB, stable, no growth after idle model drop. Recorded
  in [memory budgets](memory-budget.md).

- [x] **Now item 1 implemented: MCP tools in read-only chat**
  ([Plan 27](plans/27-read-mode-mcp-tools.md)). Composer Tools toggle (Claude
  Code/Codex with at least one enabled server), confirmation dialog naming the
  servers, per-conversation ephemeral opt-in reset by New chat and
  conversation switch, delivery gate `allowEdits || (chatTools &&
  cliProviderSupportsMcp)`, prompt lines naming the servers, privacy.md
  updated. Verified: 42 core CLI tests and 28 chat-provider browser tests pass
  on chromium and webkit; `pnpm check` exit 0. Not yet exercised against a
  live MCP server in the running app.

- [x] **Now item 3a implemented: automatic vault recall in chat** (#104).
  At send time the message's significant terms (bilingual stopwords,
  mentions/URLs/code stripped) drive one OR-composed FTS query; the top
  three passages ride the model-bound message with provenance, fenced as
  vault data beside the mention block. Private notes excluded at the SQL
  level; mentioned notes left to their mention; failures degrade to no
  recall. Verified: 11 unit tests, 5 real-SQL scenarios on the dev
  bridge's SQLite (daily-note recall with date, bm25 ranking, private
  never surfaces, off-vault silence, mention dedupe), full core suite
  2128/2128, chat browser suites green on both engines in CI.
- [x] **Now item 3b implemented: user-taught vault skills**
  (`agents/skills/`, this PR). One markdown file per skill (frontmatter
  `description:`, H1 name, steps); the prompt carries only the catalog —
  name, description, path — and the agent reads a skill on match
  (progressive disclosure, like memory digests). `private: true` hides a
  skill; under write approval, new/changed skills route through the
  existing pending-proposal queue (the approve path already creates a
  missing target), so R7's user-review holds. Not yet exercised in a live
  conversation.
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

1. **Live checks with the user**: (a) Now 1: real MCP server + Tools toggle
   in a read-only conversation; (b) Now 2: send an image in chat, restart,
   confirm the restored conversation renders it from disk; (c) Now 3: ask a
   question a daily note answers and confirm the recalled passage shows up
   in the reply; teach a skill ("salvala come skill"), approve it from the
   Agents screen, invoke it in a fresh conversation.
2. **Memory follow-ups** that emerge from Now item 3 usage (roadmap Next).

## Session log

- 2026-08-30 — Implemented Now 3a (automatic vault recall in chat, #104)
  and Now 3b (user-taught skills under `agents/skills/`, catalog in the
  prompt, teaching routed through the pending-approval queue). Scope for
  item 3 sharpened with the user before building (recall first, both
  halves).

- 2026-08-30 — Implemented Now 2 (attachments off base64, protocol carve-out,
  conversation-delete sweep) and ran the never-run native memory benchmark on
  the current build (peak 515 MB bounded).
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
