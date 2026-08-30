# Kore working state

**Updated:** 2026-08-30 at `770f7a4a` (post-v0.39.0, third polish slice
merged).
**Rule:** Every session that moves the program updates this file before its
summary: tick what became true and how it was verified, set the next step,
refresh the date. What is done and what is next live here and only here. Why
things are built this way lives in [docs/decisions/](decisions/); what the
product is lives in the [roadmap](roadmap.md) (app-first) with the Personal OS
direction in [Plan 25](plans/25-personal-os.md). The full shipped history stays
in the [delivery log](delivery-log.md); this file tracks only the active work.

## Current focus

**The Now ladder is shipped; the program waits on live checks and the next
decision.** v0.38.0 carried agent memory (recall #104 + skills #106),
v0.39.0 carried the S3-minimal durable runtime
([TDR 0007](decisions/0007-durable-runtime-minimal.md)) and the first two
backlog-B polish slices; the third slice (tab list menu, graph ⌥click
local view) is merged on master awaiting the next bump. What remains open:
the live checks below with the user and whatever the next roadmap decision
pulls in. B05c preview tabs was declined ("not for now", 2026-08-30) —
the backlog-B pass is closed. Dependency advisories cleared the same day:
esbuild pinned to the patched 0.28 line (GHSA-g7r4-m6w7-qqqr) and h2
bumped past RUSTSEC-2026-0258; both audits report zero vulnerabilities.

## What is true now

- [x] **Backlog-B pass, first slice: tab drag-reorder (B05a) and browser
  Clip to note (B04d).** Tabs reorder by drag along the strip (dnd-kit, the
  sidebar-pinned pattern; order persists in the settings tab list; clicks,
  double-click pin, and middle-click close keep working via the 4px
  activation distance). The in-app browser's toolbar gains Clip to note: it
  reads the shown page and spools the same link-capture envelope the Chrome
  extension produces (new `in-app-browser` source), so a clip rides the
  whole existing pipeline — drain, dedup, daily-note placement, enrichment;
  non-http(s) pages refuse at the schema. B04's other polish (address bar,
  back/forward, reload) predates this pass — verified already shipped.
  Verified: strip suite 15/15, pane + context-rail suites 28/28 on
  chromium (webkit in CI). Same pass, second slice — **graph polish
  (B03b/c)**: nodes color by their first tag (folded-key order in core's
  `getGraphMap`; stable hue hash over the theme-safe graph palette) and a
  header search lights matching notes up in place (accent fill + label,
  the rest recede; match count in the header; the canvas repaints through
  a ref so a keystroke never rebuilds the layout). Verified: core
  graph-map 2/2, screen suite 3/3 on chromium. Third slice — **B05b tab
  list menu and B03a local view, in its non-breaking variant**: the strip
  gains a list-all-tabs menu (every open tab by full title, active one
  checked; hidden under two tabs) — the overflow affordance without
  measurement logic — and ⌥-clicking a graph node focuses its two-hop
  neighborhood (BFS in `graph-map-focus.ts`; "focused on X · Show all"
  chip; plain click still opens the note, so no existing gesture moved).
  Verified: focus helper 5/5, strip suite 16/16, screen suite 3/3 on
  chromium. B05c preview tabs: **declined by the user (2026-08-30, "not
  for now")** — a single click keeps opening a permanent tab; the backlog-B
  pass is closed.

- [x] **Now item 4 implemented: S3 minimal durable runtime**
  ([TDR 0007](decisions/0007-durable-runtime-minimal.md)). One process-wide
  FIFO run lock in Rust (leases per window, swept on window destroy and on
  each fresh JS context) composed under `withAgentRunLock`, so chat edit
  turns and routines serialize across every window; a durable in-flight
  marker (atomic single slot under the app data dir) that recovery turns
  into an "interrupted" failure entry with normal backoff on the next
  launch, per graph; Stop on the running routine from the Agents screen
  (abort reaches the native process-tree kill; no failure strike); and a
  native minute tick so hidden-window throttling cannot starve schedules.
  Deliberately out (R4): job tables, durable event-run queue, execution
  with no webview, approval checkpoints. Verified: Rust lock/marker unit
  tests, 5 new lock-composition tests and the interrupted-run test in core,
  routines-section browser tests incl. the Stop row (chromium; webkit is
  CI-only in this container), `cargo fmt`/`clippy -D warnings` clean,
  typecheck green.

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
  (`agents/skills/`, #106). One markdown file per skill (frontmatter
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

1. **Backlog-B polish pass** (user decision 2026-08-30, alongside S3): work
   the executable-without-device items — B03 graph polish, B04 browser
   controls/clip-to-note, B05 tab reorder/overflow — smallest useful slices
   first.
2. **Live checks with the user**: (a) Now 1: real MCP server + Tools toggle
   in a read-only conversation; (b) Now 2: send an image in chat, restart,
   confirm the restored conversation renders it from disk; (c) Now 3: ask a
   question a daily note answers and confirm the recalled passage shows up
   in the reply; teach a skill ("salvala come skill"), approve it from the
   Agents screen, invoke it in a fresh conversation; (d) Now 4: start a
   routine, quit Kore mid-run, relaunch and see the interrupted entry +
   retry; Stop a running routine from the Agents screen.
3. **Memory follow-ups** that emerge from Now item 3 usage (roadmap Next).

## Session log

- 2026-08-30 — Backlog-B third slice: list-all-tabs menu (B05b) and the
  graph local view (B03a) as ⌥click-to-focus — chosen over changing the
  primary click, which stays "open the note". v0.39.0 shipped mid-session
  (S3 + the first two polish slices). Only B05c (preview tabs) remains,
  gated on the user.
- 2026-08-30 — Backlog-B pass: tab drag-reorder (B05a), browser Clip to
  note (B04d, riding the existing capture-envelope pipeline with a new
  `in-app-browser` source), graph tag colors + search highlight (B03b/c).
  Audited B03/B04/B05 against the code first: B04's controls were already
  shipped; B03a parked as a user UX call.
- 2026-08-30 — Implemented Now 4, the S3-minimal durable runtime (TDR 0007):
  cross-window run lock, durable in-flight marker + launch recovery, Stop on
  a running routine, native scheduler tick. S3 pulled from Next to Now by
  user decision (with a backlog-B polish pass queued next); v0.38.0 shipped
  earlier in the session (recall + skills).
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
