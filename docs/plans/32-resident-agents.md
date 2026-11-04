# Plan 32 — Resident agents: Kore as the home agents share

> **Status (2026-11-04):** Concept only, by Mario's choice (2026-11-04); no slice
> is built until he reopens it. Recommended first slice if reopened: slice 1.
> Italian write-up for Mario:
> `/mnt/project-files/analisi/agenti-residenti-in-kore.md` (project files).

## Why

On 2026-11-04 Mario proposed that Kore, the knowledge core, also host AI
agents in the style of Grok bot (x.ai) and Owni (his own agent platform), so
that agents of different kinds, each with its own connections, live in the
same workspace as notes, CRM and collections. This follows the 2026-11-01
vision shift: Kore as a portable memory vault every agent can reach.

## The line: Kore is the home, not the engine

Agent runtimes already exist and are not rebuilt here: Owni (durable runtime,
channels, outbox, approvals), Hermes (Emily on Telegram), Grok bot, Claude
Code and Codex (Kore's in-app engines). What none of them has is a shared
place where each agent has an identity, a memory, permissions and a visible
history of what it did. Kore provides that place. Channels (Telegram,
WhatsApp) stay out of scope.

Product rule (2026-10-10): no dedicated feature for what the AI chat already
does. New surfaces are identity, permissions, history and approvals only.

## What already ships

- Profiles: `agents/<slug>/soul.md` + `memory.md`, shared `agents/user.md`,
  `agents/memory/{facts,log,pending}.md` (`packages/core/src/ai/agent-profiles.ts`).
- Routines: daily, weekly, collection-event, script-gated; CLI engines only
  (`agent-routines.ts`, `agent-routines-runner.tsx`), minimal durable runtime
  (TDR 0007).
- Agents screen (`components/agents/agents-screen.tsx`), vault skills.
- MCP client servers for chat: one global list, `settings.mcpServers`.
- Vault agent contract (#308); remote MCP over HTTP with OAuth (#294), one
  shared token (`apps/cli/src/mcp_http/oauth.rs`); MCP writes are not
  attributed to any agent.
- In flight: `kore index` (#315), hybrid search and guarded `edit_note` (#316).

## Agent model

An agent stays a folder of Markdown. `soul.md` frontmatter grows:

| Key | Values | Meaning |
|---|---|---|
| `kind` | `local` \| `remote` | runs inside Kore, or connects over MCP |
| `runtime` | free text (`claude-cli`, `grok-bot`, `hermes`, `owni`, ...) | display and filtering only |
| `access` | `read` \| `write` (default `read`) | remote MCP write permission |
| `connections` | list of MCP server names | local agents: subset of `settings.mcpServers` |
| `scope` | list of folders | enforceable for remote agents only (see risks) |

Secrets never go in the vault: per-agent tokens live in the keychain
(service `"lore"`). The vault's own AGENTS.md memory routing keeps priority.

## Slices

1. **Every agent has a name and a key (recommended first).** Per-profile
   tokens for `kind: remote` agents in the remote MCP authorizer; per-agent
   read/write and revoke in Settings → Agents; the server resolves the calling
   agent and signs each write (agent slug) into a per-agent activity record
   (vault file vs. runtime table decided in implementation); the profile page
   lists recent writes. The current single token keeps working as an unnamed
   agent until revoked. Rust owns token checks and the caller identity; core
   owns the policy and the record. Outcome: 100% of remote MCP writes
   attributed to a named agent.
2. **Connections per agent.** `connections:` filters the MCP servers handed to
   Claude Code / Codex when that profile runs (chat and routines). Minimal
   slice of Plan 25 I03, without the full Connection registry.
3. **The agent in the workspace.** A sidebar Agents section; an agent opens as
   a page (soul, memory, routines, activity, pending proposals), like folder
   pages. Light version of Plan 25 I19.
4. **Always on.** Headless runner on top of `kore index` (#315) for
   `kore mcp --http` and routines on an always-on host.

## Risks

- Creep into Plan 25 (deferred 2026-08-30): no slice opens Connections, OAuth
  to providers, or multi-Graph grants. Stop if one needs them.
- Overlap with Owni: Owni is the runtime; it reads Kore through MCP like any
  other agent.
- Folder `scope` cannot be enforced for local CLI engines (they read the vault
  directly; only `private: true` is a hard block). The UI must say so.
- Injection between agents: read by default, signed writes, per-agent revoke,
  no MCP writes to `AGENTS.md` or `agents/*/soul.md`.
- Validation debt: slice 1 must be exercised live with two external agents
  before slice 2 starts. Checkpoint: 2026-11-18.
