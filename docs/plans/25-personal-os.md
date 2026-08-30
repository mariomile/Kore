# Plan 25 — Kore Personal OS

**Status:** Planned; no target initiative is certified complete.
**Updated:** 2026-08-27.
**Goal:** Connect user-owned knowledge, structured data, accounts, agents, and
automations through explicit Graph boundaries and a durable runtime.
**Authority:** [Target architecture](../kore-target-architecture.md) and
[TDR 0006](../decisions/0006-personal-os-boundaries.md).
**Source:** [Complete supplied specification](../kore-architecture-source.md).
**Navigation:** [Roadmap](../roadmap.md) · [All planning documents](../planning-index.md).

## How to use this plan

I01–I29 are the canonical initiative IDs. Each defines scope, dependency, affected
seams, and completion evidence. P0–P3 are priority/dependency groups, not dates.
“Extend” means related source exists; it does not mean the target contract or
installed app has passed its acceptance tests. All work below remains planned.

This is a program plan, not authorization to implement every initiative at once.
Before each slice, verify current source, resolve its open architecture decisions,
write a bounded implementation plan, and identify tests and data-safety gates.
Do not change release versions, install dependencies, or publish a build as part
of planning. Plans 01–24 remain references for existing behavior and residual work.

## P0 — Foundations

### I01 — Graph and domain contracts

- **Outcome:** Every operation knows its context and identity without adding Space.
- **Features:** Stable Graph/Agent/Object/Connection IDs; local User ownership;
  Graph registration/settings; extensible Object types; RunContext and invocation
  identity; global versus Graph-owned data boundaries; the ten source ADRs.
- **Dependencies:** None. TDR 0006 records direction; code contracts remain open.
- **Seams:** `core/graph`, `core/ai`, Graph provider, native graph commands, shared
  schemas. All `core/*` references below mean `packages/core/src/*`.
- **Done when:** Domain logic has no React dependency; two Graphs retain distinct
  identities across reopen/rename, and stale generation writes remain blocked.

### I02 — Connection registry and multi-account identity

- **Outcome:** Several accounts of one provider coexist without routing collisions.
- **Features:** ConnectorDefinition, persisted Connection CRUD, immutable IDs,
  editable labels, account metadata, capabilities, transport metadata, duplicate
  detection that still permits legitimate alternate auth contexts/transports;
  connecting/connected/refresh_required/error/disabled/disconnected states; health.
- **Dependencies:** I01, I05 for real credentials, I23 for durable storage design.
- **Seams:** `core/ai/mcp.ts`, settings, native storage, settings components.
- **Done when:** Two same-provider accounts and a third added later need no schema
  exception; renaming an account cannot redirect a tool or lose credentials.

### I03 — Graph grants and Agent authorization

- **Outcome:** Product Agent sees only work; Chief of Staff sees explicitly granted Graphs.
- **Features:** GraphConnectionGrant, AgentGraphGrant, AgentConnectionGrant;
  capability restrictions; allow/deny/approval policy; Graph and Agent defaults;
  runtime intersection with system policy, OAuth scopes, and Automation policy;
  revocation checks before every action and after approval.
- **Dependencies:** I01–I02; enforcement shared with I04/I07.
- **Seams:** Graph/agent models, runtime authorization, context assembly, settings.
- **Done when:** Spoofed IDs, stale defaults, unauthorized explicit accounts, Graph
  switches, and revocation of queued/running jobs cannot bypass grants.

### I04 — Capabilities, resolver, and MCP cutover

- **Outcome:** Agents request capabilities rather than raw MCP server implementations.
- **Features:** CapabilityRegistry, ConnectorAdapter, ConnectionResolver,
  sanitized ConnectionHandle, ToolInvocationContext; canonical email/calendar/
  files/issues/messages capabilities; native, MCP stdio/HTTP, browser, plugin
  transports; read aggregation; deterministic single-account writes; typed errors.
- **Dependencies:** I01–I03, I05; cutover decision before replacing existing MCP data.
- **Seams:** `core/ai/mcp.ts`, `core/ai/agent-cli.ts`, chat delivery, native CLI bridge.
- **Done when:** No domain execution depends on `settings.mcpServers`; fake account
  choices fail closed; adapters receive the exact authorized invocation identity.
- **Cutover constraint:** Inventory existing configs/secrets, choose a data-preserving
  transition, then remove the obsolete execution path. Source EPIC 4's temporary
  adapter is recorded, not approved against the repo's no-compatibility rule.

### I05 — Credential and OAuth lifecycle

- **Outcome:** Every account can reconnect safely without leaking secrets.
- **Features:** Extend existing keychain with SecretStore/secretRef ownership;
  API keys, OAuth initialization, refresh, expiry, revocation, scope changes,
  rotation, reauthentication; permanent versus transient errors; redacted logs;
  secure browser-session and headless provisioning design.
- **Dependencies:** I01; evolves alongside I02 before live connector access.
- **Seams:** `core/secrets/keychain.ts`, `core/ai/secrets.ts`, native `secrets.rs`.
- **Done when:** Expiry refreshes correctly; revoked credentials require reconnect;
  prompts, logs, settings, Markdown, and exports contain no secret values.

### I06 — Stable Object identity and references

- **Outcome:** Rename/move does not break knowledge or structured relationships.
- **Features:** Extend existing ULIDs; Object-to-Graph-to-current-path index;
  identity for remaining Object kinds; duplicate/missing-ID handling; stable
  references with human-readable rendering; safe adoption for existing files.
- **Dependencies:** I01, I23; relation serialization decision before changing data.
- **Seams:** `core/graph/create-note.ts`, Markdown, note references, native index,
  `crates/index-schema`, [Plan 17](17-readable-filenames.md).
- **Done when:** Internal/external rename and move retain identity, backlinks, and
  relations; duplicate IDs are surfaced; no wholesale re-ID or silent overwrite.

### I07 — Durable native execution

- **Outcome:** Jobs and routines survive webview lifecycle independently of React.
- **Features:** Native runtime boundary, persistent queue/worker, scheduler that
  enqueues jobs, run state, job attempts, durable retries/backoff, timeouts,
  cancellation, graph/object locks shared by windows/CLI/headless, IPC observation,
  restart recovery and approval checkpoints.
- **Dependencies:** I01–I06 contracts, I08 for mutative runs, I23 storage/recovery.
- **Seams:** `agent-routines-runner.tsx`, `core/ai/agent-routines.ts`,
  `core/ai/agent-run-lock.ts`, native agent CLI/routine commands; extract only the
  shared Rust modules required by a working slice.
- **Done when:** Webview close/reopen does not lose work; two clients see the same
  job/lock; runtime restart recovers state; cancellation reaches the worker.

### I08 — Approvals, audit, and safe side effects

- **Outcome:** Every action has an accountable actor/account and can stop for review.
- **Features:** Pending/approved/rejected/expired approvals; exact account and
  input preview; checkpoint/resume without replaying earlier steps; per-call
  audit (started/succeeded/failed/blocked), correlation IDs, redaction; idempotency
  keys where supported and explicit uncertainty otherwise.
- **Dependencies:** I03–I05, I07; minimal read audit ships in the first slice.
- **Seams:** Native invocation middleware/storage, agent activity UI, memory approval
  patterns. Memory-write approval alone is not this generalized contract.
- **Done when:** Every side effect is attributable; revoked/expired approval blocks;
  resumed jobs do not duplicate actions; uncertain sends stop for reconciliation.

## P1 — Reference workflows and connected knowledge

### I09 — Gmail and Google Calendar reference connectors

- **Outcome:** The complete two-Graph/four-account golden scenario works.
- **Features:** Two Gmail and two Calendar Connections using the same domain;
  Gmail search/read/list_threads, then draft/send/archive/label; Calendar search/
  read/availability, then create/update/delete; explicit account selection and
  authorized read fan-out. Draft creation can itself be a provider mutation.
- **Dependencies:** I02–I05; I07–I08 gate writes and background execution.
- **Seams:** Connector adapters, secrets, existing calendar UI and agent tools.
- **Done when:** Chief of Staff reads both accounts, Product Agent only work;
  ambiguous writes block; explicit work-account actions use work and are audited;
  Calendar and a third Gmail require no Gmail-specific domain exceptions.

### I10 — Connections and permissions UX

- **Outcome:** The user can understand and control what every account/agent can do.
- **Features:** Provider-grouped account list/add/detail; identity, status, scopes,
  capabilities, grants, health, last use/sync, audit; rename, reconnect, disable,
  disconnect/delete; Graph and Agent grant editors/defaults; clear ambiguity and
  authorization errors. Extend existing settings and Agents surfaces.
- **Dependencies:** I02–I05; minimal setup accompanies I09, not a later separate app.
- **Seams:** Settings MCP section, Graph settings, Agents UI, shadcn primitives.
- **Done when:** Two same-provider accounts remain distinguishable throughout setup,
  use, approval, and error recovery; all core actions are keyboard reachable.

### I11 — Agent identity, memory, skills, and model policy

- **Outcome:** Persistent agents reuse only the context they are allowed to see.
- **Features:** Stable identity, soul, skills, model policy and provider independence;
  cross-Graph agents; minimal RunContext; User/Graph/Agent/Conversation/Object
  knowledge separation; memory source/author/time/confidence/scope; portable files,
  progressive disclosure and reviewed writes; effective-access/settings UI.
- **Dependencies:** I01/I03/I05/I06; full execution uses I07–I08.
- **Seams:** Existing profiles, memory/pending proposals, agent skills, chat context.
- **Done when:** Switching agent/Graph cannot leak memory or capabilities; model
  changes preserve identity and policy; retrieved memories retain provenance.

### I12 — Universal Resource layer and connector sync

> **Re-scoped 2026-08-30 (roadmap decision):** the normalized Resource store is
> not scheduled; retrieval is agent-led over capabilities (see I13 note). The
> surviving piece is per-Connection sync cursors, deferred to I16 polling.
> The scope below is retained as the source-traceable reference.

- **Outcome:** External data has one retrievable, attributable representation.
- **Features:** Object versus Resource separation; source+Connection+external-ID
  uniqueness; raw versus normalized data; provenance/trust; Resource links/API;
  Gmail/Calendar mapping; per-account sync cursors, freshness policy, cache lifecycle,
  fresh/stale/syncing/error states and sync lag.
- **Dependencies:** I03–I06/I09/I23. Minimal envelope accompanies I09; normalized
  retrieval must precede I13. Expansion to more providers is I24.
- **Seams:** Native store/index, `core/indexing`, connector adapters.
- **Done when:** Same external ID in different accounts cannot collide; cached
  Resources obey current grants and retain source/account/freshness.

### I13 — Universal search and Ask Kore

> **Re-scoped 2026-08-30 (roadmap decision):** not built as a first-party
> subsystem. The agent is the query planner: capabilities (`email.search`,
> `calendar.search`, …) are exposed as chat tools, the agent fans out over
> authorized accounts and synthesizes, and results render per-item
> account/source provenance. ⌘K stays vault-only. Revisit only if agent-led
> retrieval proves insufficient. The scope below is retained as the
> source-traceable reference.

- **Outcome:** One query answers from notes, Gmail, and Calendar, then more sources.
- **Features:** Query/context planner, local index + Resource DB + live queries,
  merging/ranking/deduplication; lexical, filters, semantic, graph proximity;
  freshness/time constraints; visible citations/provenance; current/selected/all
  authorized Graph scope; explicit partial failures and cached-versus-live labels.
- **Dependencies:** I03/I09/I11/I12. Entity-aware retrieval extends later with I18.
- **Seams:** `core/indexing/search.ts`, chat tools/context, search and chat UI.
- **Done when:** A weekly project query returns attributable notes/email/events,
  with no unauthorized result or source suggestion and no hidden failed source.

### I14 — Structured Objects and Database contract

- **Outcome:** Existing Collections support durable structured knowledge workflows.
- **Features:** Reconcile Database/DatabaseView with typed tags; stable schema and
  Object membership; text/number/boolean/date/datetime/select/multi-select/url/email/
  Object-reference/Resource-reference types; validation; table/list/board/calendar,
  filters/sort/group/visible properties; stable-ID relations and portable schemas.
- **Dependencies:** I06/I12, TDR 0005; approve view/relation serialization first.
- **Seams:** `core/tags`, collection queries, settings, property editors, existing
  Collection views. Keep current schemas/values in Markdown.
- **Done when:** Round-trip external edits and index rebuild preserve data; views
  share the same rows; relations survive moves; missing target types are tested.

## P2 — Operating workflows

### I15 — Advanced views, aggregations, rollups, and formulas

- **Outcome:** Structured views derive useful data without duplicating knowledge.
- **Features:** Extend existing count/empty/original/unique rollup contract after
  stable relations; additional aggregations, rollups, then formulas; created_time,
  updated_time/created_by semantics; timeline/gallery/custom views as later scope.
- **Dependencies:** I14; custom extension views also depend on I26.
- **Seams:** Property schema, collection queries/calculation layer, view components.
- **Done when:** Calculations have deterministic errors/dependency handling and
  rebuild correctly; no formula can bypass privacy or execute arbitrary side effects.

### I16 — Normalized events and durable automations

- **Outcome:** External changes trigger controlled work without an open webview.
- **Features:** Event model/bus; manual/schedule/event/webhook/resource_change
  triggers; provider-independent email/calendar/issue/PR/object/resource events;
  conditions → workflow/agent → actions; durable enqueue, deduplication, execution
  history, UI builder, grant revalidation. Retain script gates and collection events.
- **Dependencies:** I07–I09/I12; external providers extend with I24.
- **Seams:** Existing routines/schedule UI, collection events, native runtime.
- **Done when:** A work email produces a contextual draft and approval; duplicate
  delivery does not duplicate actions; revoked grants block queued work.

### I17 — Browser Profiles and browser execution

- **Outcome:** Agents operate authenticated websites through the correct identity.
- **Features:** Persistent isolated cookies/session/local-storage profiles;
  Graph/Agent grants and defaults; browser commands, navigation, screenshots,
  click/input, upload/download, cancellation and action audit; API/MCP preference.
- **Dependencies:** I03/I05/I07/I08; runtime/service lifecycle must be explicit.
- **Seams:** Existing sandboxed browser window, native process/session management,
  capability adapters. Viewing a page today is not authenticated automation.
- **Done when:** Work agents cannot open personal sessions; uploads honor private
  data restrictions; profiles do not share authentication or privileged app IPC.

### I18 — Entity graph and identity resolution

- **Outcome:** People, companies, projects, products, topics, and accounts connect
  across local Objects and external Resources.
- **Features:** Entity/EntityIdentity, source/account IDs, confidence, conservative
  matching candidates, confirmation and correction UI, cross-source person/project
  views and search context.
- **Dependencies:** I06/I12/I13; more sources increase coverage through I24.
- **Seams:** Resource/index layer, relation/Graph views, context planner.
- **Done when:** Ambiguous identities are not silently merged; corrected links and
  confidence are inspectable; inaccessible source identities do not leak.

### I19 — Action Center and operational observability

- **Outcome:** Users can reconstruct a run and recover from its failures.
- **Features:** Unified agent/automation runs, approvals, tools, changed notes,
  connection issues, browser actions and timelines; typed errors; run/job/retry/
  automation success, OAuth failures, connection/tool latency and failure rate,
  ambiguity/approval rates, search latency/sources/freshness, tokens/cost/duration,
  resource sync lag; timeouts/backoff/rate limits/circuit-breaker visibility.
- **Dependencies:** I07/I08; extend as I12/I13/I16/I17 land.
- **Seams:** Existing activity ledger/history and Agents/chat surfaces, native audit.
- **Done when:** A failed or blocked action shows actor, Graph, account, cause,
  approval, and safe recovery action; unavailable token/cost data is not invented.

## P3 — Controlled platform access

### I20 — Kore MCP server and portable memory access

- **Outcome:** External AI can use authorized Kore knowledge and memory.
- **Features:** Authenticated MCP server, explicit Graph scope, search/get/list
  Objects/query Graph/get memory; reviewed remember; later create/update Object
  and invoke Connection with strict permissions; audit and revocation.
- **Dependencies:** I03/I06–I08/I11–I13; external API naming/pairing decision.
- **Seams:** Existing `apps/cli` discovery contracts plus shared native runtime.
- **Done when:** An external client sees only granted context; writes require
  permission/approval; every invocation is audited and revocation takes effect.
- **Naming:** Source `lore.*` names are examples, not an implemented public API.

### I21 — Headless runner

- **Outcome:** The same runtime operates on an always-on Mac or self-hosted server.
- **Features:** Runtime binary, config, service lifecycle, Graph loading, client
  authentication, connectors, scheduler, MCP, sync coordination, health monitoring,
  platform credential provisioning and restart recovery.
- **Dependencies:** I07/I08/I20/I23; no mandatory hosted service.
- **Seams:** Extract tested native runtime boundary; reuse CLI/build conventions.
- **Done when:** Desktop and headless pass the same authorization/job tests;
  service restart retains durable state; multi-client writes cannot bypass locks.

### I22 — Mobile knowledge and remote control

- **Outcome:** iPhone captures and reads locally, and controls persistent remote work.
- **Features:** Preserve current Tauri mobile knowledge/search/chat/capture flows;
  paired runner selection, remote run state, approvals, reconnect and offline state;
  long-running agents, monitoring and browser work execute on desktop/headless.
- **Dependencies:** Local residual validation continues independently; remote
  features require I07/I08/I19/I21/I23 and approved pairing/privacy design.
- **Seams:** Existing mobile tree and Plans 19/21–24; no SwiftUI rewrite.
- **Done when:** Physical-device capture/chat/privacy and runner approval/reconnect
  are verified; UI never promises always-on iOS execution. Signing/TestFlight work
  requires its own authorized task and is not performed by this plan.

### I23 — Storage, sync, and recovery contracts

- **Outcome:** Durable state survives upgrades/rebuilds without unsafe device sync.
- **Features:** Separate knowledge sync, runtime coordination, and secrets;
  versioned schema changes; Graph/global storage ownership; uniqueness/indexes;
  resource/event retention; snapshots and restore tests on representative copies;
  protect chat/jobs/grants/approvals/audit; per-Connection cursors; multi-runtime
  ownership and remote credential provisioning.
- **Dependencies:** Storage design starts in P0 with I01; remote coordination is P3.
- **Seams:** `crates/index-schema`, native database/rebuild and iCloud/Git modules.
- **Done when:** Index rebuild and supported upgrade/restore preserve all durable
  records; no live SQLite/WAL or plaintext secrets ride file sync; competing
  runtime owners cannot execute the same side effect independently.

### I24 — Additional connectors

- **Outcome:** Slack, Linear, GitHub, Drive, Notion, web and local-file context use
  the reference contracts, not provider-specific agent logic.
- **Features:** Connector-by-connector auth, account identity, capability mapping,
  Resources, search, events, read/write policy, health and conformance tests.
- **Dependencies:** I09 golden scenario and I12/I13; event/write slices need I16/I08.
- **Seams:** Connector registry/adapters, normalized events and Resources.
- **Done when:** Each added provider passes account isolation, privacy, provenance,
  and revocation tests without changing the core domain. Do not build fifty first.
- **Phase:** Expansion may start in P2 after the reference gates, before SDK work.

### I25 — Connector SDK and custom MCP catalog

- **Outcome:** Third parties add integrations under the same permission model.
- **Features:** Connector manifest/schema and adapter contract, capability and auth
  declarations, conformance tests, installation/disable/revocation, origin/trust
  information and Graph/Agent grants; custom MCP marketplace/catalog later.
- **Dependencies:** I04/I09/I24; mature security gate I29.
- **Seams:** Established connector modules; public API design before SDK release.
- **Done when:** A third-party connector cannot escape declared capabilities or
  grants; installing a catalog entry does not automatically authorize execution.

### I26 — Plugin SDK

- **Outcome:** Controlled UI, command, view, and extension contributions.
- **Features:** Extension boundary, API contract, permissions, lifecycle, reviewable
  manifests and disable/uninstall; custom Database views use the same data policy.
- **Dependencies:** I14/I25/I29; separate public API/security design required.
- **Seams:** Existing commands/views and Tauri capabilities; no speculative framework.
- **Done when:** One reference plugin adds a useful view/command without access
  beyond its grants, and disabling it leaves user knowledge readable.

### I27 — Optional hosted runner

- **Outcome:** Optional continuous execution without an always-on personal machine.
- **Features:** Opt-in deployment, authenticated clients, secure secrets provisioning,
  runtime parity, data-egress controls, ownership/backup/export and cost visibility.
- **Dependencies:** I21/I23/I29; separate hosting/product/security decision.
- **Done when:** Hosted and self-hosted runners obey the same policies; disabling
  hosting leaves local knowledge usable. No mandatory Kore-hosted API dependency.

### I28 — Collaboration

- **Outcome:** Future multi-user sharing without weakening local ownership.
- **Features:** Explicit shared-Graph membership, roles, account ownership, revocation,
  conflict resolution, multi-device/multi-user audit and isolated private context.
- **Dependencies:** Stable single-user multi-Graph/multi-account runtime and I23/I29.
- **Seams:** Future scope; schema, UX, encryption and sync design need discovery.
- **Done when:** A separately approved collaboration plan proves isolation, conflict
  handling and export. This is deferred, not a commitment to build team features now.

### I29 — Security, resilience, and quality gates

- **Outcome:** Permission and recovery behavior is tested before feature claims.
- **Features:** Resolver/policy/property/event unit tests; storage/OAuth/adapter/
  queue/approval/audit integration tests; golden E2E; concurrency matrix; malicious
  MCP output, prompt injection, SSRF, path traversal, spoofed accounts, secret
  leakage, unauthorized browser profiles and mid-run revocation tests; performance
  and operational error checks. Stub model calls in deterministic tests.
- **Dependencies:** Starts with I01 and gates every initiative, not deferred to P3.
- **Seams:** Existing Vitest/Playwright/Rust suites and per-feature tests.
- **Done when:** The relevant gate below passes with evidence and residual risks;
  historical security reports are not reused as certification of new boundaries.

## First implementation slices

| Slice | Scope | Exit evidence | Explicit exclusions |
|---|---|---|---|
| S1 — Account-safe read ([Plan 26](26-account-safe-read.md)) | I01–I05, minimal I08 audit, I09 Gmail and I10 setup: 2 Graphs, 2 Gmail, Chief of Staff/Product Agent, resolver, `email.search` | Live account isolation plus deterministic tests of forged IDs, revocation, secret-free handles and provenance | No browser, provider writes, event workflow, Entity Graph or new Database UI |
| S2 — Second provider | Add two Google Calendar accounts through the same contracts | Both calendars aggregate only for authorized agent; no Gmail-specific domain change | No connector catalog expansion |
| S3 — Durable execution | I06–I08/I23: native jobs, scheduler, locks, attempts, checkpoints; enable approved write capabilities only after gates | Start/close/reopen UI; state restored; runtime stays active; approval resumes exact action; uncertain send cannot duplicate | No claim of execution after runtime process termination or iOS suspension |
| S4 — Agent retrieval in chat (re-scoped 2026-08-30) | Capabilities as chat tools; provenance rendered on results | Agent answers a project query from notes/email/events with account and source attributed per item | No Resource store, no first-party search subsystem, no Entity auto-merge |
| S5 — Structured knowledge | I14: extend current typed Collections and ID-backed relations | Existing Markdown round-trips; shared rows in views; references survive rename/move | No speculative replacement of Collections or formula platform |

Source sections 130–134 describe these slices. Section 138 puts durable runtime
before the completed Gmail/Calendar architecture gate. Reconciliation: S1/S2 are
bounded read-only validation, not a completed foundation/runtime release. Secure
credentials, runtime-side authorization and minimal audit are required from S1;
mutations/background guarantees wait for S3. The whole P0 gate remains open until
identity and durable execution pass. Resources are normalized before universal
search, resolving the P1-search/P2-resource ordering in source sections 108–109.

## Acceptance and release gates

All boxes below are unchecked. They define future evidence, not results of this
documentation update. A UI demonstration alone cannot satisfy a gate.

### Foundation and golden scenario

- [ ] Create Personal and DeepAgent Graphs with stable identities.
- [ ] Connect Gmail Personal/Work and Calendar Personal/Work concurrently.
- [ ] Grant only the matching accounts to each Graph.
- [ ] Product Agent can access only DeepAgent; Chief of Staff can access both.
- [ ] Authorized cross-account reads aggregate with visible provenance.
- [ ] Unauthorized explicit accounts, fake IDs, and stale defaults fail closed.
- [ ] Ambiguous sends do not execute; explicit authorized work sends resolve work.
- [ ] Secrets never enter model context, logs, Markdown, or exports.
- [ ] Every action retains actor, Graph, Agent, account, run, action, result, time.
- [ ] Object rename/move preserves IDs, backlinks, and stable relations.
- [ ] Add Calendar, a third Gmail, and a later provider without a domain exception.

### Runtime and security

- [ ] Webview reload/close leaves work running while the runtime is alive.
- [ ] Runtime restart restores queued jobs, retries and approval checkpoints.
- [ ] Scheduler produces Jobs; cancellation and runtime-global locks work.
- [ ] Approval rejection/expiry blocks; approval resume does not replay prior work.
- [ ] Revoked grants block queued jobs and the next action of an active run.
- [ ] OAuth expiry refreshes; revoked refresh token requires reconnect.
- [ ] Concurrency covers same-Graph readers/writers, different Graphs, same agent
      across jobs, agents on one Object, different accounts, desktop+CLI/headless.
- [ ] Injection, malicious MCP, SSRF, traversal, account spoofing, secret leakage
      and unauthorized browser-profile tests pass with no capability escalation.
- [ ] Non-idempotent uncertain actions stop for reconciliation.
- [ ] Index rebuild/upgrade/recovery preserves knowledge, chat and runtime records.

### Operating workflows

- [ ] Search spans notes, Gmail, Calendar with freshness, source and account.
- [ ] Graph switch/revocation removes inaccessible cached context and results.
- [ ] Structured Objects retain Markdown ownership and shared view data.
- [ ] Normalized external events trigger durable, deduplicated workflows.
- [ ] Authenticated browser actions use the correct granted profile and audit.
- [ ] Entity confirmation does not expose or merge unauthorized source identities.

### Platform

- [ ] External MCP clients query knowledge/memory through authenticated grants.
- [ ] Memory/Object/Connection writes use the same approval and audit boundary.
- [ ] Headless executes the same policy and durable-job conformance suite.
- [ ] Mobile pairs, observes, approves and reconnects without an always-on claim.
- [ ] Connector/plugin extensions cannot bypass grants or leak secrets.
- [ ] Optional hosting remains optional; collaboration has a separate approved plan.

Source section 103's 15 E2E scenarios and section 135's 20 architecture outcomes
are covered by these gates; sections 104–105 add concurrency/security dimensions.
Implementation evidence must include source revision, command/test, result,
runtime/platform and unresolved blockers. Real-account/device tests require
available credentials/devices and must never be replaced by claims from stubs.

## Existing backlog retained outside the new program

These items were already deferred or follow-ups in the roadmap/plans. Their target
implementation status was not re-audited here; verify before scheduling.

| ID | Residual work | Treatment |
|---|---|---|
| B01 | Beta release channel | Deliberately parked; release work requires its own task |
| B02 | Cursor in-flight steering | Dependency on provider streaming-input support; verify current CLI before implementation |
| B03 | Graph local view, tag coloring, search highlight | Optional polish after foundation work |
| B04 | Browser address/back/forward controls and clip-to-note | Separate from I17 authenticated automation |
| B05 | Note-tab drag reorder, overflow menu, preview semantics | Preserve as bounded editor-shell follow-ups |
| B06 | Meowdown editor glyph alignment | Upstream editor work in its own repository |
| B07 | Mobile queued-message parity and outstanding device passes | Coordinate I22 and Plans 19/22/23/24; no signing or publishing implied |
| B08 | Generic Git HTTPS credential-helper support | Plan 16 V2; do not change current sync ownership |
| B09 | AI-assisted sync-conflict resolution | Existing Plan 21 deferral; separate privacy/data-safety approval |

Plan 20 already records asset descriptions as implemented; Plan 23 records mobile
chat implementation with residual device checks; Plan 24 records a simulator pass
and physical-device follow-up. Those are dated document reports, not fresh test
results. The old Plan 13 closure is retained as historical scope; do not infer
absence of current import/export features or open a new portability suite here.

## Source traceability

The full source is preserved so requirements do not disappear during synthesis.
This table covers all source sections, including cross-cutting and later work.

| Source sections | Coverage |
|---|---|
| 1–4 | Product thesis, invariants, domain → target architecture; I01/I29 |
| 5 | Graph → I01/I03 |
| 6–7 | Connector/Connection, states, multi-account → I02 |
| 8–10 | Graph/Agent grants, golden scenario → I03/I09 |
| 11–17 | Capabilities, handles, resolution, effects, invocation, transports → I04/I08 |
| 18–19 | Browser Profiles and grants → I17 |
| 20–23 | Object IDs, model, Markdown/SQLite and file index → I06/I23 |
| 24–27 | Databases, properties, views, relations → I14 |
| 28 | Rollups/formulas sequencing → I15 |
| 29–32 | Resources, identity, normalization → I12 |
| 33–36 | Universal/hybrid search and provenance → I13 |
| 37–38 | Entity identity → I18 |
| 39–42 | Agent definition, cross-Graph access, RunContext → I03/I11 |
| 43–50 | Runtime, jobs/states, retries, locks, scheduler → I07 |
| 51–56 | Automations, triggers, event normalization and example → I16 |
| 57–60 | Effective permissions, approvals, continuation → I03/I08 |
| 61–62 | Audit and Action Center → I08/I19 |
| 63–64 | Secure storage, OAuth → I05 |
| 65–67 | Injection, escalation, MCP security → I04/I29 |
| 68–70 | Runtime tables, uniqueness and indexes → I02/I12/I23 |
| 71 | MCP transition proposal → I04; open cutover decision |
| 72–75 | Gmail/Calendar capabilities and account tests → I09 |
| 76–77 | Ask Kore and context planner → I13 |
| 78–79 | Memory scopes and provenance → I11 |
| 80–81 | Portable memory and external AI → I20 |
| 82 | Headless → I21 |
| 83 | Mobile architecture → I22 |
| 84 | Optional cloud runner → I27 |
| 85 | Separate sync domains → I23 |
| 86 | Module boundaries → target architecture; I01/I07 |
| 87 | Connection/grant/invocation APIs → I02–I04 |
| 88–93 | Connection, Graph, Agent, defaults and action UX → I10/I11/I08 |
| 94–98 | Observability, metrics, errors, resilience, idempotency → I08/I19/I29 |
| 99–100 | Cursors and freshness → I12/I23 |
| 101–102 | Versioned schema/data transition and compatibility proposal → I23; open cutover decision |
| 103–105 | Unit/integration/E2E, concurrency, security → I29 and gates |
| 106 | Ten ADRs → TDR 0006 D01–D10 |
| 107 | P0 → I01–I08; I23/I29 from the start |
| 108 | P1 → I09–I14; reuse existing capabilities |
| 109 | P2 → I12–I19/I24; Resource ordering reconciled above |
| 110 | P3 → I20–I28 |
| 111 | Non-goals and deferred work → roadmap, dependencies and exclusions |
| 112–120 | Source EPIC 0–8 → I01/I02/I03/I04/I05/I07/I08/I09 |
| 121–128 | Source EPIC 9–16 → I12/I13/I14/I16/I17/I18/I20/I21 |
| 129 | Four release gates → acceptance and release gates |
| 130–134 | First five slices → S1–S5 |
| 135 | Twenty architecture outcomes → all gate groups |
| 136–137 | Final architecture and positioning → target architecture |
| 138 | Absolute priority → roadmap and slice/gate reconciliation |

I06, I10, I11, I15, I19, I22–I29 make requirements outside the source's 17 epics
explicit. They are not extra product scope invented from the code audit.

## Planning update verification — 2026-08-27

This evidence validates the documentation update, not the future feature gates:

- Supplied source preserved byte-for-byte after its provenance header; SHA-256
  recorded in the source document.
- All 138 numbered source sections covered exactly once by the traceability ranges;
  29 unique initiative IDs; all 92 documents under `docs/` present in the inventory.
- Local links and linked heading anchors checked; historical roadmap delivery log
  unchanged; `git diff --check` passed for tracked changes.
- `pnpm check` passed (TypeScript, formatting, oxlint, ESLint). Oxlint reported the
  existing 513-line editor module exceeding its 500-line guidance; no code changed.
- `pnpm build` passed for desktop frontend and browser extension. Warnings concern
  unchanged Vite JSON-import configuration, large chunks/plugin timing, and absent
  Sentry credentials; Sentry release/source-map upload was not performed.
- No application code, schema, credentials, versions, or release files changed.
  Native builds, device/live-account tests and UI E2E were not run for this
  Markdown-only change. No commit, push, release or TestFlight upload was performed.
