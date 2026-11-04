# Plan 32 — Kore as the shared brain for every agent

> **Status (2026-11-04):** Concept; no slice approved yet. Reframed by Mario
> the same evening from "agents living inside Kore" to "Kore is the portable
> memory every agent shares". Italian write-up for Mario:
> `/mnt/project-files/analisi/kore-cervello-condiviso.md` (project files).

## Why

Mario (2026-11-04): Kore must become, fast, the home for memory and documents
of all his agents (Grok bot, Claude Code, ChatGPT, Claude, later Muse): a
brain they share, which each agent connects to quickly and understands how to
use on its own, under the user's own rules. Reference: Living Brain
(livingbrain.com), a hosted memory layer over API/SDK/MCP with a
capture → compiled pages model and one-command setup per client.

Kore's difference: the memory *is* the user's Markdown vault. No hosted store,
no lock-in.

## What already ships

- `kore mcp` (stdio) and `kore mcp --http` with OAuth (#294); 20 tools
  (`apps/cli/src/mcp.rs`), resources and review prompts (#290).
- Self-explaining sessions: `initialize` returns Kore's instructions plus the
  vault's own AGENTS.md (#308, `instructions()`); `vault_guide` serves the rest.
- One shared token for every remote client (`mcp_http/oauth.rs`); writes are
  not attributed to any agent.
- Search in MCP needs the app-built index; lexical only until #316.
- In flight: `kore index` (#315), hybrid search + guarded `edit_note` (#316).

## Blockers, by client

| Client | Path | Blocker |
|---|---|---|
| Claude Code, Codex (Mac) | local `kore mcp` | none |
| Claude web/iPhone/Desktop | custom connector + OAuth page | Mac awake with Kore open |
| ChatGPT | Developer Mode connector, HTTPS URL, OAuth or token | untested against our OAuth; Mac awake |
| Grok bot | adds MCP by URL or by command on its cloud computer | untested; Mac awake |

## Overlap check (2026-11-04)

Already shipped: `mcpClientSetup` (Claude Code command, Claude Desktop/Cursor
JSON, #277), bundled skills in `~/.agents/skills`, Remote access card with
Copy URL / Copy token (#294), agent onboarding (#308). In flight: hybrid
search (#316) is `recall`, so no new tool; `kore index` (#315) gates slice 2.
Slice 1 therefore extends the Remote access card and adds only `remember`.

## Prior art studied (2026-11-04)

Living Brain, Honcho (plastic-labs, open-source core, peers/sessions,
background "dreaming") and Past (past.dev: audience/identity on every
write/read, current + previous values with dates and sources, one-line agent
setup prompt). Taken: a public `/setup.md` an agent reads to connect itself;
`remember` always records date, source, agent and the previous value (the
vault's own "new (from date; previously old)" form). Not taken: per-message
automatic reasoning, automatic capture of every turn, hosted memory store.
Gap they expose: Kore has no recall-quality measure; #316's eval script is the
place for one.

## Slices

1. **Connect an agent in a minute (recommended first).** The HTTP server
   serves a public, secret-free `/setup.md` (per-client steps and usage rules);
   the Remote access card offers one sentence to paste into any agent, next to
   the existing Claude Code command and JSON. Each connection mints a
   named token, revocable on its own, with "last seen". The MCP server gains
   `remember` (writes a fact where the vault contract's routing says, else the
   inbox, with date, source, agent name and the previous value on update) (`recall` is #316's hybrid search). Live test with ChatGPT and Grok
   bot. Outcome: four clients on Mario's vault; every `remember` signed.
   Layering: Rust owns tokens and caller identity; routing policy stays in the
   vault contract and core.
2. **Always on.** `kore mcp --http` on an always-on host over the git clone of
   the vault, index from `kore index` (#315). Needs a sync/conflict design for
   two writers (Mac and host).

## Out of scope

- An automatic "compiler" that scores what to remember: that is an AI
  judgment the chat and consolidation routines already make.
- A mandatory Kore cloud; rebuilding agent runtimes (Owni, Hermes, Grok bot).

## Risks

- Injection between agents: new tokens default to read, every write signed,
  per-token revoke, AGENTS.md never writable over MCP.
- Larger exposure with more tokens over Funnel.
- Sync conflicts (slice 2).
- Validation debt: slice 1 is done only when ChatGPT and Grok bot read and
  write Mario's vault for real.
