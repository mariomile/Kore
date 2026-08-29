# Plan 26 — Account-safe read (Slice S1)

**Status:** Planned. Nothing below is implemented.
**Updated:** 2026-08-29.
**Delivers:** [Plan 25](25-personal-os.md) slice **S1** — initiatives I01–I05,
the minimal I08 audit, the Gmail half of I09, and the setup half of I10.
**Authority:** [Target architecture](../kore-target-architecture.md) ·
[TDR 0006](../decisions/0006-personal-os-boundaries.md).
**Navigation:** [Roadmap](../roadmap.md) · [Planning inventory](../planning-index.md).

## Goal

Two Graphs, two Gmail accounts, two Agents with different grants, one
deterministic resolver, and one read-only capability (`email.search`) that can
be proved to fail closed. Nothing is written to a provider and nothing runs in
the background.

This slice exists to test the permission model against a real multi-account
workflow **before** the durable runtime is built (S3). If the grant contracts
are wrong, a read query surfaces it at a fraction of the cost of discovering it
after execution has moved into Rust.

## Verified starting point

Source inspected on 2026-08-29 at `e39dd393`. These are the facts the steps
below build on, not a status claim about any released build.

| Area | What exists today | Consequence for S1 |
|---|---|---|
| Graph identity | [`graphInfoSchema`](../../packages/core/src/graph/schemas.ts:4) identifies a graph by absolute `root`, folder `name`, and an open-session `generation` | **There is no stable Graph ID.** The only symbol named `graphId` in the tree is a UI local assigned the root path ([destructive-section.tsx:26](../../apps/desktop/src/components/settings/destructive-section.tsx:26)). Rename or move the folder and the identity changes |
| Agent identity | Profiles are per-graph folders, `agents/<slug>/soul.md` ([`AGENTS_DIR`](../../packages/core/src/ai/agent-profiles.ts:36)) | Agents are graph-local directories, not global identities. Cross-Graph grants have nothing to hang on yet |
| Settings storage | User-global JSON at `<config>/reflect-open/settings.json` ([settings.rs:25](../../apps/desktop/src-tauri/src/settings.rs:25)) | A user-global Connection registry already has a home. D02 needs no new storage tier for S1 |
| Secrets | Flat `name → value` keychain ([keychain.ts:19](../../packages/core/src/secrets/keychain.ts:19)), with naming conventions layered on top ([`mcpSecretName`](../../packages/core/src/ai/mcp.ts:66)) | Storage is fine; ownership is missing. A Connection must own a `secretRef`, so deleting it deletes its credentials |
| External tools | MCP servers configured in settings ([`mcpServerSchema`](../../packages/core/src/ai/mcp.ts:39)), edit-mode only, values injected through the CLI process environment and never on argv | The argv/environment discipline is the precedent to keep. S1 adds a capability layer beside it and **does not** touch or migrate `settings.mcpServers` |
| Execution | The routine scheduler and runner are a React component ([agent-routines-runner.tsx](../../apps/desktop/src/components/agent-routines-runner.tsx)); the run lock is a module-local promise chain ([agent-run-lock.ts:12](../../packages/core/src/ai/agent-run-lock.ts:12)) | S1 must not depend on either. Read queries are request-scoped and complete inside the caller |
| Graph-local storage | `/.reflect/` is written into the graph's `.gitignore` ([graph_gitignore.rs](../../apps/desktop/src-tauri/src/graph_gitignore.rs)) and marked iCloud sync-excluded ([icloud/storage.rs](../../apps/desktop/src-tauri/src/icloud/storage.rs)) | `.reflect/` **cannot** hold a portable Graph ID: it does not travel to a second device or into a Git remote |

## Step 0 — Resolve the Graph ID home (blocking)

Every later step needs a Graph ID, and the obvious location does not work.
Decide this before writing code.

| Option | Behaviour | Assessment |
|---|---|---|
| A. `.reflect/graph.json` | Local only | **Rejected.** Gitignored and sync-excluded, so the same vault gets a different ID per device |
| B. Committed file at the graph root (for example `.kore/graph.json`) | Travels with the folder through Git and iCloud | **Recommended.** Matches "the graph folder is the export", survives rename and move, and is inspectable |
| C. Path-keyed entry in global settings | No new file in the vault | Breaks on move or rename, and two devices disagree. Acceptable only as the local cache in front of B |

Recommendation: **B, with C as a lookup cache.** The ID is a lowercase ULID, the
same scheme note identity already uses, so no second ID format enters the
product. A graph with no ID file adopts one on open; a graph whose ID file is
missing or malformed is surfaced, never silently re-identified.

Open sub-questions to settle in the same decision: the file's name and whether
it carries anything besides the ID, and what happens when two folders carry the
same ID (a copied vault).

## Scope

**In:**

1. **Graph identity (I01).** Stable Graph ID per step 0, a registry of known
   Graphs, and `graphId` threaded through the invocation path as an explicit
   argument. The existing `generation` stale-write guard stays exactly as is.
2. **Connection registry (I02).** A user-global `ConnectorDefinition` and
   `Connection` model in the settings document: immutable ID, mutable label,
   account metadata, capability list, transport, status. Gmail is the only
   ConnectorDefinition in this slice; the shape must admit a second account of
   the same provider with no schema exception.
3. **Credentials (I05).** Google OAuth: authorization, token storage under a
   Connection-owned `secretRef`, refresh, expiry, and reconnect on revocation.
   Permanent and transient failures are distinguished. Secrets never reach
   settings, Markdown, logs, model context, or argv.
4. **Agent identity and grants (I03).** A stable Agent ID beside the existing
   slug, `AgentGraphGrant` and `AgentConnectionGrant`, and Graph defaults.
   Authorization is the intersection of Graph grant, Agent grant, and OAuth
   scopes; deny wins; missing grants fail closed; the check runs at execution
   time, not only at assembly time.
5. **Capability and resolver (I04, partial).** One capability, `email.search`,
   one `ConnectorAdapter` for Gmail, and the deterministic resolution ladder:
   explicit Connection, eligible Agent default, eligible Graph default, only
   eligible Connection, otherwise an ambiguity error. Reads may fan out across
   authorized accounts and every result carries its account provenance. The
   model receives a sanitized handle, never a credential.
6. **Minimal audit (I08, partial).** Every capability call records actor,
   `graphId`, `agentId`, `connectionId`, capability, outcome, and time, with
   redacted inputs. Read-only, so no approval machinery in this slice.
7. **Setup UI (I10, partial).** Add and list Google accounts, show identity,
   scopes and status, rename, reconnect, disconnect, and edit Graph and Agent
   grants. Extends the existing Settings and Agents surfaces.

**Out, explicitly:**

- Any provider write, including Gmail draft creation. Drafts are a mutation and
  wait for the S3 gate.
- Google Calendar. That is S2, and reusing these contracts unchanged is what S2
  proves.
- Durable jobs, queue, scheduler, cross-client locks, background execution.
- Resources, universal search, Ask Kore (S4); Collections and Databases (S5).
- Browser Profiles, Entity resolution, Action Center.
- Any migration or removal of `settings.mcpServers`. The MCP cutover is I04's
  later half and needs its own inventory and cutover decision.
- Mobile. iOS gains nothing in this slice.
- Version bumps, signing, TestFlight, releases.

## Acceptance

Deterministic tests, each of which must fail before the step that fixes it:

- [ ] Two Graphs keep distinct IDs across close, reopen, rename, and move.
- [ ] A copied graph folder with a duplicate ID is surfaced, not silently merged.
- [ ] Two Gmail accounts on the same domain coexist; a third needs no schema change.
- [ ] Renaming a Connection's label does not redirect a call or lose credentials.
- [ ] A forged `connectionId` or `graphId` fails closed.
- [ ] An explicitly requested unauthorized account errors and never silently
      falls back to another account.
- [ ] A stale Graph or Agent default that no longer holds a grant is revalidated
      and rejected.
- [ ] Revoking a grant blocks the next call of an in-flight sequence.
- [ ] Expired access tokens refresh; a revoked refresh token requires reconnect.
- [ ] No secret value appears in settings, Markdown, exports, logs, error
      messages, or assembled model context. Asserted, not reviewed by eye.
- [ ] Aggregated results carry per-item account provenance, and a partial
      failure is reported as partial rather than as an empty result.
- [ ] Every call leaves an audit record with redacted inputs.

Live check, requiring real credentials: the Product Agent reads only the
DeepAgent Graph's work account; the Chief of Staff reads both Graphs' accounts;
both are visible in the audit with the correct account attributed.

Stubs cannot substitute for the live check, and the live check cannot substitute
for the deterministic tests.

## Suggested build order

Split the slice in two so the contracts are proved before Google enters:

1. **S1a — contracts on a stub.** Graph identity, Connection registry, grants,
   resolver, and audit, exercised end to end against a stub connector that
   implements `email.search` over fixture data. Every deterministic acceptance
   test below runs in S1a; none of them needs Google.
2. **S1b — the real provider.** Google OAuth, the Gmail adapter, and the live
   check, behind the unchanged S1a contracts. The stub connector stays as the
   permanent test double.

## Risks

- **Google restricted scopes (see roadmap R1).** `gmail.readonly` is a Google
  *restricted* scope: shipping it to arbitrary users requires OAuth
  verification plus a CASA security assessment. S1b therefore uses a
  bring-your-own Google Cloud client in testing mode, where refresh tokens
  expire every seven days, so reconnect is a weekly reality, not an edge case.
  The acceptance line "expired access tokens refresh" covers the hourly access
  token; the seven-day refresh-token death lands on the reconnect path. Keep
  the capability layer transport-agnostic so IMAP (app password) remains an
  escape hatch for `email.search` if the OAuth friction proves too high.
- **Scope pull toward writes.** "Just a draft" is a provider mutation and would
  pull the approval and idempotency contracts forward, out of order. Hold the
  line at read.
- **The Graph ID decision leaking into data.** Adoption writes a file into the
  user's vault. Ship it behind the same no-clobber discipline note creation
  already uses, and never re-ID an existing graph automatically.
- **Two authorization paths.** While `settings.mcpServers` still exists, edit-mode
  MCP runs and capability calls enforce different rules. That is tolerable only
  because S1 is read-only and additive; the divergence must close in I04's
  cutover, not linger.
- **OAuth in a Tauri shell.** The Codex sign-in flow ([codex-login](../../packages/core/src/ai/codex-login.test.ts))
  is the in-repo precedent for a localhost callback plus the OS browser. Confirm
  it against Google's current requirements before assuming it transfers.

## Verification

`pnpm check` plus targeted tests, both browser engines for any `.test.tsx`, and
`cargo fmt` / `clippy` / `test` for Rust touched. See
[CLAUDE.md](../../CLAUDE.md) for the gates CI runs that the daily loop does not.
