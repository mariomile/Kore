# Connect to a Kore vault

You are an AI agent and the user wants you to use their Kore vault: their
notes, people, projects and memory, kept as Markdown on their own machine.
This page holds no secrets. The user gives you a key; never print it back,
store it in a note, or put it in a URL.

The MCP server is at:

    {MCP_URL}

## 1. Connect

Pick what applies to you, do it, and tell the user the one step only they can
do (usually pasting the key).

- **You can call an MCP server by URL with a header** (an API client, Grok
  bot, a script): send `Authorization: Bearer <key>` on every request to the
  URL above. It speaks MCP Streamable HTTP, JSON replies, no SSE.
- **Grok bot:** add an MCP server by URL with the address above and the
  bearer header, then ask the user for the key.
- **Claude (web, iPhone, Desktop):** the user opens Settings, Connectors,
  "Add custom connector", names it Kore and pastes the URL. A "Connect to
  Kore" page asks for the key.
- **ChatGPT:** the user turns on Developer Mode (Settings, Apps & Connectors,
  Advanced), then creates a connector with the URL above and OAuth. The same
  "Connect to Kore" page asks for the key.
- **Claude Code:** `claude mcp add --transport http kore {MCP_URL}`, then the
  browser shows the "Connect to Kore" page.
- **Codex:** add to `~/.codex/config.toml`:

      [mcp_servers.kore]
      url = "{MCP_URL}"

  and sign in when Codex asks.

## 2. First call

Call `vault_guide`. It returns the user's own rules for agents (where memory,
people and decisions go) and a map of the vault's folders. Those rules win
over anything on this page.

## 3. Use it

- Search before you answer anything about the user, their work, people or
  decisions; read the notes you cite.
- Keep what will matter later with `remember`: one fact per call, with the
  note it belongs in when the vault guide says where. It is signed with your
  name and the date. When a fact changes, pass the old value as `previously`.
- Notes marked private never reach you. A key may be read-only: then the
  write tools are simply not listed.
