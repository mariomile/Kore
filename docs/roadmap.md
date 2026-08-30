# Kore roadmap

**Updated:** 2026-08-30.
**Direction:** A local-first Personal OS for knowledge, work context, and agents.
**Status:** Target direction and priority order; nothing below is claimed as
delivered. Shipped work is recorded in the [delivery log](delivery-log.md);
what is in progress right now is in [STATE.md](STATE.md).

Read order: [planning inventory](planning-index.md),
[target architecture](kore-target-architecture.md), and the
[Plan 25 initiative catalog](plans/25-personal-os.md). The complete supplied
"Lore" specification is preserved as
[source material](kore-architecture-source.md). Kore remains the public project
name; technical and Apple identifiers are unchanged.

This revision adds a [risk register](#risk-register-2026-08-30-review) from a
full review of the source specification against current code, and per-slice
build guidance. Priorities and gates are unchanged in substance.

## Next: the five demonstrable slices

Sizes are relative complexity for agent-executed work, not calendar time.

| Slice | Scope | Size | Gate it proves |
|---|---|---|---|
| S1 — Account-safe read ([Plan 26](plans/26-account-safe-read.md)) | I01–I05, minimal I08 audit, Gmail half of I09, setup half of I10 | Large: new `core` domain module, Rust OAuth, settings UI, shared schemas | Permission model fails closed on a real multi-account workflow, before any runtime work |
| S2 — Second provider | Two Google Calendar accounts through the same contracts | Small–medium: one adapter, no domain change allowed | Contracts generalize; no Gmail-specific exception |
| S3 — Durable execution | I06–I08/I23: native jobs, scheduler, locks, checkpoints | Large: schema migration, new Rust runtime boundary, touches shared types | Work survives webview lifecycle; writes unblock only here |
| S4 — Agent retrieval in chat | Capabilities exposed as agent tools; provenance rendered on results (re-scoped 2026-08-30, see below) | Small: chat tool wiring plus provenance UI, no new store | One attributable answer from mixed sources, produced by the agent |
| S5 — Structured knowledge | I14: typed Collections extended with ID-backed relations | Medium–large: gated on the relation serialization decision | Markdown round-trips; references survive rename/move |

S1/S2 are early read-only architecture proofs; they do not complete the P0
release or permit background/write claims before S3. See
[Plan 25](plans/25-personal-os.md) for dependencies and source reconciliation.

### S1 — build guidance

- **Split the slice internally.** S1a: Graph/Agent identity, Connection
  registry, grants, resolver, and audit, exercised end to end against a stub
  connector so all twelve deterministic acceptance tests in Plan 26 run without
  Google. S1b: Google OAuth, the real Gmail adapter, and the live check, behind
  the same contracts. If the contracts are wrong, S1a surfaces it at near-zero
  cost.
- **Graph ID:** adopt Plan 26 option B (committed `.kore/graph.json`, lowercase
  ULID, local settings cache in front). Decide the duplicate-ID rule in the same
  step: the first-opened folder keeps the ID; a copy is surfaced and re-IDs only
  on explicit user action, never automatically.
- **Re-verify the starting point.** Plan 26's source facts were inspected at
  `e39dd393`; master has moved since. A re-check is cheap and required by the
  plan itself.
- **Watch out:** R1 (Google restricted scopes) is S1b's defining constraint.
  Keep the capability layer transport-agnostic so IMAP remains an escape hatch
  for `email.search`.

### S3 — build guidance

Two verified code facts shrink this slice from "rewrite execution in Rust" to
"move orchestration into Rust": the desktop process already survives window
close ([lib.rs:536](../apps/desktop/src-tauri/src/lib.rs) prevents exit) and
agent CLI processes already spawn natively
([agent_cli.rs](../apps/desktop/src-tauri/src/agent_cli.rs)). What moves is the
scheduler, queue, and lock currently living in
`agent-routines-runner.tsx` and `agent-run-lock.ts`.

- Job tables live in the durable database beside `chat_*`, under the same
  rebuild-survival contract; a tokio task owns the scheduler tick; the UI
  observes over events and issues commands only.
- Hold the line on scope: queued/running/waiting_approval/succeeded/failed/
  cancelled, persisted attempts, and one runtime-global lock is the whole S3
  contract. Anything resembling a general workflow engine is R4.
- Design the uncertain-send reconciliation screen early: Gmail has no send
  idempotency (R9), so "stop and reconcile" is the default UX for the flagship
  write, not an edge case.

### S4 / S5 — build guidance

- S4 (re-scoped 2026-08-30): unified search is **not built as a first-party
  subsystem**. The agent is the query planner: it already holds `email.search`
  and `calendar.search` as authorized capabilities and fans out, merges, and
  synthesizes natively. S4 is therefore only: expose the capabilities as chat
  tools, render per-item account/source provenance on results, and keep ⌘K as
  vault-only search. I13's planner/merger/ranker and I12's normalized Resource
  store are not scheduled; the only surviving I12 piece is per-Connection sync
  cursors, which land with I16 polling when automations need them. Accepted
  tradeoff: agent-led retrieval is live-only, slower, and costs tokens per
  query; right for a single-user agent-native product. Revisit only if
  agent-led retrieval proves insufficient in practice.
- S5: settle relation serialization first. Suggested shape: `[[wiki links]]`
  stay canonical in Markdown, the stable ULID rides beside the readable value in
  frontmatter properties, and the index resolves both. Write the external-edit
  round-trip tests before the feature.

## Priority ladder

Build on current Graphs, note ULIDs, typed Collections, keychain, profiles, and
routines. They are useful foundations, not proof of the target permission and
runtime model. The [source evidence table](kore-target-architecture.md#evidence-and-current-gaps)
distinguishes existing code from remaining work.

| Order | Priority | Initiative IDs | Outcome and gate |
|---|---|---|---|
| 1 | P0 | I01–I06, I23, I29 | Graph/domain identity, global Connections, multi-account, grants, capabilities, credentials and stable Object references; fail-closed authorization |
| 2 | P0 | I07–I08 | Native durable jobs, queue/scheduler, global locks, retries, approvals and audit; survive webview lifecycle |
| 3 | P1 | I09–I11 | Two Gmail + two Calendar + two Graphs; restricted Product Agent and cross-Graph Chief of Staff; understandable setup, scoped memory/models/skills |
| 4 | P1 | I12–I13 (re-scoped) | Agent-led retrieval over capabilities with provenance; no first-party search subsystem, no Resource store; sync cursors only, deferred to I16 |
| 5 | P1 | I14 | Extend existing typed Collections into stable Objects/Databases, references and views |
| 6 | P2 | I15–I19, I24 | Advanced calculations/views, external-event automations, Browser Profiles, Entity graph, Action Center, then additional connectors |
| 7 | P3 | I20–I23 | Controlled external MCP, headless runtime and mobile control; separate knowledge/runtime/secrets sync |
| 8 | P3 | I25–I28 | Connector SDK/catalog, plugin SDK, optional hosted execution; collaboration last |

I23 storage design and I29 security/testing start in P0 and continue through
every phase. Priority is a dependency sequence, not a delivery-date commitment.

## Risk register (2026-08-30 review)

Findings from a full pass over the 138-section source specification and the
current code. Blockers change scope decisions now; hard items need their own
design before their initiative starts; cautions are cheap if remembered early.

### Blockers

- **R1 — Gmail scopes are Google restricted scopes (I05/I09, source §6/§63–64/§72–75).**
  `gmail.readonly`/`gmail.send`/`gmail.modify` require OAuth verification plus
  an annual CASA security assessment before Google lets an app ship them to real
  users. The source treats Gmail as the trivial "prove the architecture" case;
  it is the most bureaucratically expensive integration in the plan. For
  single-user use: bring-your-own Google Cloud client in testing mode, which
  caps at 100 test users and expires refresh tokens every seven days, so weekly
  reconnect is the honest UX until verification. Consequences: reconnect must be
  first-class (I05 already requires it), S1's live check uses a BYO client, and
  distribution of Gmail access is a separate product decision, not a build task.
- **R2 — Webhook triggers have no public endpoint on a local-first app (I16, source §53/§56).**
  Gmail push needs Cloud Pub/Sub; GitHub/Linear webhooks need a reachable URL.
  Polling with per-Connection sync cursors is the honest local-first primitive;
  name it as I16's mechanism. Push delivery becomes possible only with the
  headless runner (I21) or hosted runner (I27), never on the laptop app alone.

### Hard

- **R3 — Browser Profiles (I17, source §17–19).** Authenticated automation
  meets anti-bot detection (Google, LinkedIn, most SaaS logins), and per-Graph
  leak-proof cookie/session isolation amounts to rebuilding Playwright's
  browser-context isolation. Treat I17 as experimental: a Playwright-style
  sidecar with persistent contexts, or cut it and lean on API/MCP transports.
  The "no session leak between Graphs" exit criterion is a security property to
  prove, not just implement.
- **R4 — The durable runtime is a workflow engine (I07, source §43–50).** Jobs,
  scheduler, locks, retries, event bus, and checkpointed resume are
  Temporal-class scope if built generally. The S3 contract above is the bound;
  resist generalization until a second consumer demands it.
- **R5 — Entity resolution (I18, source §37–38).** Cross-source identity is a
  research-grade problem. First pass: exact-key matches only (email address,
  account ID), no fuzzy name matching, and un-merge support before any merge
  automation.
- **R6 — Headless runner is an internet-facing service (I21, source §82).**
  Auth, TLS, patching, and secret custody on a possibly less-trusted machine,
  maintained by one person. Require a written threat model before starting;
  default to a private overlay network posture (Tailscale-style) instead of
  open ports.
- **R7 — Memory poisoning through portable memory (I11/I20, source §78–81).**
  An external MCP client can write memory that other agents later treat as
  trusted, and nothing in the source propagates a Resource's
  `external_untrusted` label into memory records distilled from it. Extend the
  existing memory-write approval to every external caller, and carry provenance
  and trust labels into `MemoryRecord` as a contract, not a convention.

### Caution

- **R8 — "Formula" is one word in the source and a full expression engine in
  practice (I15, source §25/§28).** Parser, types, dependency graph, incremental
  recompute, cycle detection. Adopt an existing sandboxed expression evaluator;
  do not invent a language.
- **R9 — Gmail has no send idempotency (I08/I09, source §97–98).** The
  spec-mandated "halt on uncertain state" is therefore the default path for the
  flagship demo write. Design the reconciliation UX with S3.
- **R10 — Connection uniqueness is under-specified (I02, source §69).** The
  `connector + external account + auth_context` constraint never defines
  `auth_context`. Define it (transport plus authorization method) before the
  registry schema lands, or the schema either allows real duplicates or blocks
  the legitimate second transport.
- **R11 — resolved by the 2026-08-30 S4 re-scope.** The source's synchronous
  multi-source search box (I13, §76–77) had no latency budget; it is no longer
  built. Agent-led retrieval streams tool calls in chat, where latency is
  visible and expected. Kept for the record.
- **R12 — The metrics list implies an observability stack (I19, source §62/§95).**
  Keep counters and durations in SQLite surfaced by the Action Center; drop the
  org-grade time-series checklist.
- **R13 — Security tests are not all one-time gates (I29, source §105).**
  Injection, SSRF, and malicious-MCP output are open-ended adversarial classes;
  schedule a recurring red-team pass rather than a single certification.
  Trust-level tagging bounds the blast radius of injection; it does not prevent
  steering within an agent's authorized capabilities.

## Non-negotiable gates

- **Foundation:** Graph/Agent/account isolation, stable IDs, secure credentials;
  ambiguous writes blocked and revocation enforced at execution time.
- **Runtime:** Durable jobs/retries, cross-client locks, approval continuation,
  complete redacted audit and safe uncertain-effect handling.
- **Operating workflows:** Unified Resources, attributable search, persistent
  external-event automation, isolated authenticated Browser Profiles.
- **Platform:** Authenticated external AI access, shared headless semantics,
  mobile control and permission-constrained extensibility.

All are open. [Acceptance checklist](plans/25-personal-os.md#acceptance-and-release-gates).
Webview closure is not runtime termination, and iOS is not an always-on executor.

## Deferred and decision-gated

No new Space primitive, fifty-connector expansion, independent Database rewrite,
mandatory hosted backend, or collaboration before single-user foundations.
No first-party universal-search subsystem: retrieval across sources is
agent-led over capabilities (2026-08-30 decision, see S4 build guidance).
Existing simple rollups remain; expanded formulas depend on stable relations.
The supplied temporary MCP adapter/compatibility proposal conflicts with
repository policy and needs an explicit cutover decision before implementation.
Storage, relation serialization, remote pairing and public API names also remain
open; see the
[open decisions](kore-target-architecture.md#delivery-order-and-unresolved-design-decisions).

## Retained fork follow-ups

[Plan 25 B01–B09](plans/25-personal-os.md#existing-backlog-retained-outside-the-new-program)
retains beta channel (parked), Cursor steering (provider-dependent),
graph/browser/tab polish, Meowdown glyph alignment, mobile queue/device checks,
Git HTTPS auth, and AI-assisted sync-conflict resolution. They do not outrank
the foundations. No bump, Apple signing, TestFlight, or release action is part
of this update.

## History

Everything this fork has shipped is recorded in the
[delivery log](delivery-log.md). Entries there are historical reports, not
fresh certifications; new target work belongs above.
