# Kore working state

**Updated:** 2026-08-30 at `029f728f` (v0.34.0).
**Rule:** Every session that moves the program updates this file before its
summary: tick what became true and how it was verified, set the next step,
refresh the date. What is done and what is next live here and only here. Why
things are built this way lives in [docs/decisions/](decisions/); what the
product is lives in the [target architecture](kore-target-architecture.md) and
[Plan 25](plans/25-personal-os.md). The full shipped history stays in the
[delivery log](delivery-log.md); this file tracks only the active wave.

## Current focus

**S1a — contracts on a stub** (first half of
[Plan 26](plans/26-account-safe-read.md), per its suggested build order):
Graph identity, Connection registry, grants, deterministic resolver, and
minimal audit, proved end to end against a stub `email.search` connector over
fixture data. No Google, no writes, no background execution.

## What is true now

- [x] Planning docs restructured: roadmap rewritten around slices with build
  guidance and risk register R1–R13, shipped history moved to the delivery log,
  Plan 26 gains the S1a/S1b split and the Google restricted-scope risk.
  Verified: all relative links in the touched docs resolve.
- [x] Plan 26's starting-point facts re-verified at `029f728f`: no stable Graph
  ID exists (grep for `graphId` outside UI locals), no
  `ConnectorDefinition`/`GraphConnectionGrant`/`email.search` symbols anywhere
  in `packages/core` or `src-tauri`. Nothing of S1 is implemented.
- [x] Two S3-relevant facts verified in source: the desktop process survives
  window close (`prevent_exit`, `apps/desktop/src-tauri/src/lib.rs:536`) and
  agent CLI processes spawn from Rust (`apps/desktop/src-tauri/src/agent_cli.rs`).

## Next step

1. **Step 0 of Plan 26 (blocking): settle the Graph ID home.** Recommendation
   on the table: committed `.kore/graph.json` with a lowercase ULID, local
   settings cache in front, first-opened folder keeps the ID on duplication.
   Record the decision as a TDR in `docs/decisions/` before writing code.
2. Then S1a proper: the Graph/Connection/grant schemas in `packages/core`, the
   resolver, the stub connector, and Plan 26's deterministic acceptance tests.

## Session log

- 2026-08-30 — Roadmap/spec review and doc restructure; risk register added;
  S1a named as first work item. No application code changed.
