# TDR 0006 — Kore Personal OS boundaries

**Status:** Accepted target direction; not implemented by this record.
**Date:** 2026-08-27.
**Source:** [User specification](../kore-architecture-source.md), especially section 106.
**Operational contract:** [Target architecture](../kore-target-architecture.md).
**Delivery:** [Plan 25](../plans/25-personal-os.md).

## Context

Kore already has local Markdown, agent profiles, MCP configuration, routines,
Collections, and a Tauri mobile app. The next wave must add authorized external
accounts and persistent execution without creating a separate product or losing
the existing knowledge model.

The ten requested architecture decisions are recorded together here. Source
ADR-001 through ADR-010 map to D01 through D10 below; they do not renumber the
repository's existing TDR 0001–0005.

| Decision | Accepted target | Consequence |
|---|---|---|
| D01 / source ADR-001 | Graph is the data/context/permission boundary; no Space | Every graph-affecting action carries an authorized Graph ID; switching Graph cannot leak context |
| D02 / source ADR-002 | Connections are user-global and granted to Graphs | No credential duplication or implicit access from global registration |
| D03 / source ADR-003 | ConnectorDefinition differs from Connection | Provider type, authenticated account identity, and mutable label cannot be used interchangeably |
| D04 / source ADR-004 | MCP is a transport | Capability resolution and authorization precede all adapters, including MCP and browser |
| D05 / source ADR-005 | Markdown is canonical knowledge; runtime state is durable | Preserve schema/knowledge files and `chat_*`; index rebuilds cannot wipe runtime state |
| D06 / source ADR-006 | Objects have stable IDs independent of paths | Extend existing ULIDs; approve relation serialization and collision handling before conversion |
| D07 / source ADR-007 | Runtime owns execution; UI is a client | Native queue, scheduling, locks, cancellation, retries, and approval checkpoints survive webview lifecycle |
| D08 / source ADR-008 | Writes use deterministic account resolution | Explicit request, eligible Agent default, eligible Graph default, only eligible account, otherwise ambiguity; never guess |
| D09 / source ADR-009 | Recheck permissions at execution time | Revoked grants block queued/resumed work; approvals do not override denies |
| D10 / source ADR-010 | Local-first with optional remote execution | Desktop/headless share semantics; iOS controls long-running work; cloud is never required |

## Supersession and unchanged contracts

For the next wave, D07 supersedes the blanket “Rust is only primitives; TS owns
all policy” rule in [architecture conventions](../plans/architecture-conventions.md).
It does not require moving every TS function to Rust. D05 extends durable storage
beyond today's chat exception, subject to an explicit storage/recovery design.

[TDR 0005](0005-tag-types-and-collections.md) remains the current implemented
Collection contract. D06 establishes the target for stable-ID relation semantics;
it does not silently rewrite wiki-link properties. Existing TDRs, filenames,
Apple identity, private-note hard blocks, and release procedures remain intact.

## Decisions not made here

Temporary adapters/backward compatibility versus a clean cutover remains an
explicit conflict between source sections 71/102 and repository guidance. Neither
an adapter nor a data conversion is approved here. Runtime store location, remote
pairing, portable view format, and external API names also require implementation
design decisions. See the [open decisions](../kore-target-architecture.md#delivery-order-and-unresolved-design-decisions).

## Verification required

Two Graphs, two Gmail accounts, two Calendar accounts, a restricted Product Agent,
and a cross-Graph Chief of Staff must demonstrate account isolation, deterministic
mutations, no credential leakage, revocation while queued, durable jobs, complete
audit, and preservation of knowledge/chat during index rebuild and recovery.
The [Plan 25 gates](../plans/25-personal-os.md#acceptance-and-release-gates) are not
marked complete by accepting these decisions.
