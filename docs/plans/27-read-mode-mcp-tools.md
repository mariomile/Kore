# Plan 27 — MCP tools in read-only chat

**Status:** Design accepted 2026-08-30 (roadmap Now item 1); implementation in
this wave.
**Outcome:** "Search my mail" in a normal chat: the user's configured MCP
servers become available to agent chat (Claude Code / Codex) without turning on
edit mode, behind an explicit per-conversation opt-in.
**Navigation:** [Roadmap](../roadmap.md) · [STATE](../STATE.md).

## The privacy contract, before and after

Read-only chat is a zero-egress surface by invariant: nothing but the model
sees note content, and both CLI engines run with `WebSearch`/`WebFetch`/`Bash`
denied (Claude) or a restricted-network sandbox (Codex), and no MCP
configuration at all. Edit mode was the single opt-in that brought MCP tools
along.

After this change the invariant becomes: **read-only chat is zero-egress by
default**. A conversation gains MCP tools only when the user flips the Tools
toggle in the composer and confirms a dialog that names the servers involved
and states that chat content and notes the agent reads may reach them.

Decisions that keep the contract honest:

- **Per-conversation, ephemeral session state.** The opt-in follows the
  existing per-conversation instructions precedent: React state in the chat
  provider, never persisted. New chat, switching conversations, and app
  restart all reset it to off. Reopening an old conversation never silently
  re-arms tools. No `chat_*` schema change.
- **The toggle is scoped to engines whose MCP path exists.** Claude Code and
  Codex only (`cliProviderSupportsMcp`); Cursor's per-run `.cursor/cli.json`
  denies MCP by design, and BYOK engines have no MCP path. With no enabled
  MCP server configured, the toggle does not render.
- **Everything else about read mode is unchanged.** Vault tools stay
  `Read`+`Glob` (Claude) / read-only sandbox (Codex); private notes,
  `.reflect/`, and `.git/` keep their deny rules; `Bash`, `Grep`,
  `WebSearch`, `WebFetch` stay denied. MCP is additive, not a mode change.
- **The prompt tells the truth.** Both engines' read-mode prompts currently
  say "only Read and Glob are available". With servers riding (either mode),
  the grounding line names the external tools, and the existing safety rule
  keeps applying: never send note/memory/vault content to an external tool
  unless the user explicitly asked in this conversation.

## Mechanics

The plumbing already exists for edit mode; the change is the gate:

```text
composer Tools toggle (per conversation, confirm dialog)
  → chat provider session state + ref
  → deliver: mcpServers = (allowEdits || toolsOn && supportsMcp)
      ? resolveMcpServers(settings.mcpServers) : []
  → Claude: --strict-mcp-config + --mcp-config + permissions allow mcp__<name>
    Codex:  -c mcp_servers.* overrides
  (secrets keychain-resolved per run, env-injected, never argv — unchanged)
```

Touched seams: `packages/core/src/ai/{cli-providers,claude-cli,codex-cli,mcp}.ts`
(prompt line + `cliProviderSupportsMcp`; MCP arg plumbing is already
mode-independent), `apps/desktop/src/providers/{chat-context,chat-provider,chat-provider-deliver}`,
`apps/desktop/src/components/chat/chat-input.tsx`, [privacy](../privacy.md).

## Acceptance

- [ ] Read-mode run with tools off carries no `--mcp-config` / `mcp_servers.*`
      argument (zero-egress default preserved).
- [ ] Read-mode run with tools on carries the MCP configuration while the
      vault tool set stays read-only (`Read`,`Glob` / read sandbox) and every
      deny rule is unchanged.
- [ ] The toggle renders only for Claude Code/Codex with at least one enabled
      server; enabling requires the confirmation dialog naming the servers.
- [ ] New chat and conversation switch reset tools to off.
- [ ] Read-mode prompt names external tools only when servers ride the run.
- [ ] privacy.md describes the new opt-in.
