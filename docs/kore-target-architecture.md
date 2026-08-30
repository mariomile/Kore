# Kore: Personal OS target architecture

**Status:** Adopted product direction; implementation and release gates remain
open. Deferred 2026-08-30 by the app-first decision (see [roadmap](roadmap.md)):
this remains the long-term direction, not the active backlog.
**Updated:** 2026-08-27.
**Scope:** Next development wave of this repository, not a new application.
**Source:** [User-supplied Lore specification](kore-architecture-source.md), sections 1–138.
**Execution plan:** [Plan 25](plans/25-personal-os.md).
**Navigation:** [Roadmap](roadmap.md) · [Planning inventory](planning-index.md) · [Decisions](decisions/0006-personal-os-boundaries.md).

## Product outcome

Kore is evolving toward a local-first operating system for personal knowledge,
work context, and AI agents. Markdown knowledge, structured objects, external
accounts, agents, and automations share one permission-aware Graph model.

Daily notes remain the capture default. Association, keyboard access, portable
files, minimal editor chrome, direct user-approved providers, and `private: true`
remain constraints. Structured data and an Action Center extend the current
product; they do not justify replacing the editor with a second application.

“Lore” in the supplied document means Kore's target direction. It does not
authorize renaming `@reflect/*`, Rust crates, the `reflect` CLI, `.reflect/`,
`app.lore.*`, `iCloud.app.lore`, or the Memento desktop bundle.

## Evidence and current gaps

Source inspection at `ab96c077` on 2026-08-27, not a runtime certification or a
claim about the installed/released build:

| Area | Existing source evidence | Remaining target work |
|---|---|---|
| Graphs | [Graph schemas](../packages/core/src/graph/schemas.ts) identify the current root and session generation | Durable Graph IDs, explicit grants, multi-Graph run context; keep generation checks against stale writes |
| Note identity | [Note creation](../packages/core/src/graph/create-note.ts) already writes lowercase ULIDs to frontmatter; [Plan 17](plans/17-readable-filenames.md) covers readable filenames | Extend identity to all Object kinds, references, external moves, collisions, and Graph-scoped resolution; do not invent a second ID scheme |
| Structured knowledge | [Tag schema](../packages/core/src/tags/tag-type.ts), [collection queries](../packages/core/src/indexing/collections.ts), [saved views](../packages/core/src/settings/schema-collections.ts), and [TDR 0005](decisions/0005-tag-types-and-collections.md) | Evolve Collections into the target Database contract, ID-backed relations, missing property semantics, portable view definitions, expanded calculations |
| Views and calculations | Collection table/board/calendar components, note list/grid, and a rollup schema already exist | Do not schedule those as greenfield features; validate their end-to-end coverage, then add only missing Database behavior |
| MCP | [MCP configuration](../packages/core/src/ai/mcp.ts) has server IDs and keychain-backed values; [chat delivery](../apps/desktop/src/providers/chat-provider-deliver.ts) resolves raw servers | Global authenticated Connections, canonical capabilities, deterministic account routing, grants, and a transport-only MCP boundary |
| Credentials | [Keychain bindings](../packages/core/src/secrets/keychain.ts) already store credentials outside files | Connection-owned secret references, OAuth lifecycle, rotation, reconnect, headless secure-store behavior, redaction tests |
| Agent routines | [Routine model](../packages/core/src/ai/agent-routines.ts) includes schedules, collection events, retry metadata, and history | Durable queue, normalized external events, runtime-owned scheduling and checkpoints |
| Execution | [Runner](../apps/desktop/src/components/agent-routines-runner.tsx) executes from React; [lock](../packages/core/src/ai/agent-run-lock.ts) is a module-local Promise queue | One native execution owner independent of webview lifetime, locks shared by all clients, cancellation and restart recovery |
| Agent context | [Profiles](../packages/core/src/ai/agent-profiles.ts) and [pending memory](../packages/core/src/ai/agent-memory-pending.ts) are existing seams | Stable agent identity, cross-Graph grants, distinct memory scopes, skills and model policies in an authorized RunContext |
| Calendar | [Calendar display policy](../packages/core/src/calendar/events.ts) and the native calendar bridge exist | Gmail/Google Calendar reference Connections with explicit account provenance; native calendar UI is not proof of this contract |
| Durable data | [Database module](../apps/desktop/src-tauri/src/db/mod.rs) preserves `chat_*` across index rebuilds | Protect new runtime records as durable state; never place them in a wipeable projection without a separate lifecycle |

## Domain and ownership

| Primitive | Contract |
|---|---|
| User | Local owner of Connections, Browser Profiles, model configuration, and global settings; no mandatory hosted account |
| Graph | Data, context, and permission boundary with a stable ID; never introduce an equivalent Space |
| Object | User-owned page, note, project, person, meeting, task, or custom type; stable ID, mutable path, typed properties |
| Database / View | Collection of Objects plus schema; views contain filters, sorting, grouping, and visible properties, not duplicate rows |
| ConnectorDefinition | Provider/integration type, supported capabilities, transports, authentication requirements, metadata schema |
| Connection | One authenticated identity, immutable ID, mutable label, account metadata, scopes, status, and secret reference |
| Resource | External item keyed by source type + Connection ID + external ID, with provenance, trust, and freshness |
| Entity | Conservatively resolved identity across Objects and Resources; ambiguous merges require confirmation |
| Agent | Identity, soul, memory, skills, model policy, grants, and runtime policy; may access multiple explicitly granted Graphs |
| BrowserProfile | Isolated authenticated session state with explicit Graph and Agent grants |
| Automation / Event / Job | Trigger and conditions produce durable work; events are normalized; jobs own attempts, scheduling, checkpoints, and cancellation |
| Approval / AuditEvent | Durable authorization decision for an exact action; attributable execution history with redacted inputs/results |

Connections and Agents are not duplicated per Graph. Access is expressed through
`GraphConnectionGrant`, `AgentGraphGrant`, `AgentConnectionGrant`, and equivalent
Browser Profile grants. Global registration alone grants no access.

Cross-Graph runs carry `activeGraphIds`, but every graph-affecting invocation
has one authorized `graphId`. Global bookkeeping may omit a Graph; it may not
use a missing Graph ID as permission to access every Graph. Resource caches may
deduplicate transport data, but every retrieval must enforce current Graph and
Agent grants, including after a grant is revoked.

## Invocation and authorization

```text
Desktop / mobile / CLI / external MCP client
  → authenticated request + run identity
  → Graph and Agent context
  → capability + eligible Connections
  → deterministic Connection resolver
  → runtime authorization and privacy check
  → approval/checkpoint when required
  → transport adapter
  → redacted audit + result with provenance
```

Permission is the intersection of system policy, Graph grant, Agent grant,
Connection scopes, and Automation policy. Deny wins; an approval cannot override
a deny. Missing required grants fail closed. Recheck before execution, after
approval, and before later steps of a long-running job.

Resolution order: Explicit Connection → eligible Agent default → eligible Graph
default → only eligible Connection → ambiguity error. Revalidate defaults too.
An explicitly requested unauthorized account must fail, not silently switch to
another account. Reads may fan out across authorized accounts with provenance;
writes must name one resolved identity. No model-selected permission escalation.

Propagate `runId`, `graphId`, actor/`agentId`, `connectionId`, capability, and effect
to the final adapter; include `jobId`, `automationId`, `browserProfileId`, and
`approvalId` when applicable. Human requests retain explicit actor identity.
Model context receives sanitized Connection handles, never credentials.

Capabilities cover email, calendar, files, issues, and messages. Prefer a reliable
native API, then MCP stdio/HTTP, then browser automation. Plugins may implement
the same adapter contract. The choice of transport must not change authorization.

Untrusted email, web pages, documents, and MCP output are data. They cannot change
the run's instructions, grants, destination account, or approval. The existing
`private: true` content prohibition applies to every external egress path,
including remote runners, model prompts, browser uploads, and tool arguments.

## Persistence and runtime

| Data | Target ownership and recovery |
|---|---|
| Notes, pages, user-authored properties, readable agent memory | Canonical Markdown; preserve external editing, file portability, and existing IDs |
| Collection schemas | Keep the current Markdown ownership from TDR 0005; SQLite is their projection, not a second canonical copy |
| File paths, backlinks, FTS, embeddings | Rebuildable indexes keyed by stable identity |
| Chat history | Existing durable `chat_*` exception; index repair must continue to preserve it |
| Connections, grants, jobs, attempts, approvals, audit, scheduler state | Durable runtime storage, with versioned schema changes and explicit backup/recovery policy |
| Resources, sync cursors, normalized events, entities | Declare authoritative versus derived records and retention per table; cache eviction must not erase audit or authorization |
| Credentials and browser sessions | OS/platform secure storage and isolated profile storage; never Markdown, Git, model context, or plaintext exports |

The physical runtime database location, view-definition format, and lifecycle are
implementation decisions still to be resolved. A Graph index rebuild must never
erase grants, jobs, approvals, audit, or chat. Knowledge sync, runtime coordination,
and secrets provisioning are separate protocols; do not sync a live SQLite/WAL
database through iCloud or Git. Existing iCloud/Git exclusivity remains intact.

The Rust runtime owns queue workers, agent runs, scheduling, locks, retries,
connectors, browser execution, approvals, events, and audit. The scheduler creates
Jobs; the UI observes and commands. Persist attempts, next-attempt time, failure
reason, and workflow checkpoints. Jobs move through queued, running,
waiting_approval, succeeded, failed, and cancelled.

Webview reload/closure must not kill a job while its runtime remains active.
Process restart requires recovery; it is not uninterrupted execution. Running
after the desktop process exits requires a service/headless runner. iOS is a local
knowledge and control client, not a promised always-on worker.

Side effects require idempotency when available. An uncertain send result must
stop for reconciliation, not retry blindly. Use runtime-wide lock ownership,
timeouts, backoff, rate limits, and circuit breakers where appropriate.

## Knowledge, context, and UI

- Resource normalization separates raw provider payload from the common projection.
  Preserve account, source URL, timestamps, trust, and fresh/stale/syncing/error state.
- Search plans across local indexes, cached Resources, and live Connections; merge
  and rank lexical, metadata, semantic, and graph signals. Show partial failures and
  cached versus live results. Ask Kore supports current, selected, or all authorized
  Graphs. Never expose unavailable sources in the picker or retrieved context.
- Extend typed Collections with Object/Resource references and missing types, then
  ID-backed relations, aggregations, expanded rollups, and formulas. Existing basic
  rollups are a baseline, not permission to skip relation correctness.
- Keep User, Graph, Agent, Conversation, and Object knowledge distinct. Memory
  carries source, author, time, confidence, and scope; writes retain review policy.
- Connections UI shows provider and account identity, scopes, grants, status,
  health, sync, usage, and reconnect. Graph/Agent settings expose effective access
  and defaults. Sensitive action previews show the exact account and payload.
- The Action Center unifies runs, approvals, tool calls, changes, errors, connection
  problems, and browser actions. Reuse current Agents/chat/settings surfaces and
  shadcn components; detailed navigation design precedes broad UX changes.

## Existing module seams, not a speculative repo rewrite

Start in `packages/core/src/{graph,ai,tags,indexing,settings,secrets,calendar}`,
`packages/db`, `apps/desktop/src/{providers,components,mobile}`,
`apps/desktop/src-tauri/src`, `crates/index-schema`, and `apps/cli`.
Extract a shared Rust runtime boundary only when the first native job slice needs
it. Proposed `lore-*` crate names in the source are conceptual, not approved
renames or a request to create seven empty crates. Keep TS client/domain helpers;
security-critical execution policy must be enforced by the native runtime.

## Delivery order and unresolved design decisions

The [roadmap](roadmap.md) orders active work and defers this program;
[Plan 25](plans/25-personal-os.md) defines
the complete initiative catalog, first slices, acceptance tests, and source map.

1. Establish Graph/Connection/Agent contracts, grants, capabilities, credentials,
   existing-ID extension, and the runtime/audit boundary.
2. Validate two Gmail accounts, then two Calendar accounts. Read-only discovery
   slices can precede full daemon extraction; no side-effect or background claim
   may bypass the runtime/approval gate.
3. Normalize Resources before universal search, then extend structured Objects.
4. Add external-event automations, Browser Profiles, and Entity resolution.
5. Expose controlled MCP access and headless execution, then connector/plugin
   ecosystems. Hosted execution and collaboration remain later optional work.

Open decisions before affected implementation:

- **Transition policy:** Source sections 71/102 propose temporary legacy adapters
  and backward compatibility; repository guidance rejects compatibility layers.
  The product requirements are retained, but no legacy adapter or destructive
  conversion is authorized by this documentation update. Obtain an explicit
  cutover decision, data inventory, and backup/restore acceptance first.
- **Storage:** Global versus Graph durable-store ownership, portable Database/View
  format, event/resource retention, and headless credential provisioning.
- **Relations:** Preserve readable wiki links while introducing stable-ID referential
  semantics; confirm serialization before changing existing frontmatter.
- **Remote boundary:** Client authentication/pairing, grant revocation propagation,
  runtime coordination, secret provisioning, and remote privacy policy.
- **Public surface:** External MCP names in the source (`lore.*`) are conceptual;
  approve the published API before implementing it. No compatibility alias is implied.
- **Scheduling:** P0–P3 describe dependency/priority groups, not delivery dates,
  estimates, staffing commitments, or release authorization.
