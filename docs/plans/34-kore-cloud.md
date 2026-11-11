# Plan 34 — Kore Cloud (the vault always on, in the user's own Cloudflare)

> **Status (2026-11-09):** slice 1 (the Worker, `apps/cloud/`) written and
> tested; slices 2-4 not started. Italian plan for Mario:
> `/mnt/project-files/kore-cloud-spike/PIANO.md`; spike measurements:
> `/mnt/project-files/kore-cloud-spike/RISULTATI.md` (project files).

## Why

Agents reach Kore through `kore mcp`, which runs where the vault is: on the
Mac. When the Mac sleeps, Claude on the phone, ChatGPT and a Grok bot lose
the vault. Mario (2026-11-09) wants Kore always on for every agent, with no
server to run, free, and set up the same way by anyone, with or without the
app. He rejected a VM or a container (PR #332) and chose, from a research
pass over hosts and sync services, Cloudflare Workers + D1 on the free plan,
in the user's own Cloudflare account, with the notes stored there and the app
syncing both ways (GitHub stays optional for people who already use it).

This keeps "No Kore-hosted APIs": the Worker, the database and the keys live
in the user's account; Kore operates nothing.

## Shape

- **One Worker per vault** (`kore-cloud` on the user's `*.workers.dev`), with
  three bindings: `DB` (D1), `OAUTH_KV` (KV, OAuth grants and tokens) and the
  secret `KORE_ACCESS_KEY`. `KORE_VAULT_LAYOUT` (JSON `VaultLayout`) tells it
  where daily notes and new notes go, as the app reads them from `.obsidian/`.
- **D1 holds the notes.** One row per note: path, full source, and the parsed
  title, tags and text for the FTS5 index (`unicode61 remove_diacritics 2`).
  `version` counts writes to a note (compare-and-swap); `seq` orders every
  write in the vault (the change feed). A deletion is a tombstone, so it can
  be pulled.
- **Agents** use `/mcp`: stateless JSON-RPC (no session), the same tool names
  and arguments as `kore mcp` for the subset Kore Cloud serves (`vault_guide`,
  `search`, `read_note`, `recent_notes`, `append_to_note`, `edit_note`,
  `create_note`, `set_properties`) and the vault's `AGENTS.md` (else
  `CLAUDE.md`) inlined in `instructions` up to 12,000 characters. Claude and
  ChatGPT sign in through OAuth (`@cloudflare/workers-oauth-provider`: DCR,
  client metadata documents, PKCE); the consent page asks for the access key.
  A CLI may send the access key itself as the bearer token.
- **Writes are structural.** Every agent write reads the note, applies one
  edit (append, exact-passage replace, property patch, create), and writes
  with the version it read; on a lost race it rereads and reapplies (three
  attempts). Nothing overwrites text the writer has not read.
- **The app syncs** through `/sync/changes?since=` (pull) and `/sync/push`
  (compare-and-swap writes; conflicts come back with the current note so the
  app keeps both sides, the same rule as git sync). Pushes may carry `meta`
  (title, tags, text from the app's own parser) so the Worker spends no CPU
  on Markdown.
- **Private notes never enter.** Every write path refuses a source with
  `private: true`; a note made private in the app is pushed as a deletion.
- **Rules shared with the app** come from `@reflect/core` (parser, slug,
  daily paths, layout, frontmatter patching), so a note written in the cloud
  reads exactly as one written on the Mac.

## Limits that shape the code (Workers Free, D1 Free)

- 10 ms CPU per request. Parsing a note costs about 1 ms (median of a 5,165-
  note vault, p95 2.7 ms, worst 7 ms, measured in Node): a push carries at
  most 5 writes without `meta`, 20 with. Real CPU per request is still to be
  measured on a real account.
- About 50 D1 queries per invocation: a push is one batch (one `seq`
  reservation plus one statement per write) and at most one conflict read.
- 100,000 rows written per day: a first upload of a 5,000-note vault writes
  each note once plus its index rows. To measure on a real account.
- 5 M rows read per day: a search over very common words reads up to ~13,000
  rows (spike).
- A note larger than 1 MB is refused (D1 rows cap at 2 MB).

## Slices

1. **Worker** (`apps/cloud/`): store, MCP, OAuth, sync API, tests over a
   better-sqlite3 D1 stand-in plus a full OAuth round trip; local
   `wrangler dev` smoke. *Done, this PR.*
2. **Setup through the API**: `kore cloud setup` (Rust CLI) opens Cloudflare's
   token page with the permissions prefilled
   (`dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=…`), takes the
   pasted token, creates D1 + KV, uploads the Worker bundle, sets the access
   key (stored in the keychain), uploads the notes. First run on Mario's
   account measures the open limits above.
3. **App sync**: policy in `packages/core/src/sync/` (cursor, push with base
   versions, conflict copies, private → delete), HTTP in a thin Rust command,
   the same split as git sync.
4. **Settings → Kore Cloud**: activate, status, "Add to Claude", "Add to
   ChatGPT", copy the URL and key for other agents.

## Open

- **Access (Mario, 2026-11-10):** the owner key stays in the app and drives
  `/sync/*` and `/agents`; each agent is approved once at the consent page,
  under a name and as read-only or read-and-write, and every write stores
  that name (`author`, null for the owner) so the app's Activity attributes
  it. Done in slice 2. Propose-only agents (Plan 33 A2) wait for app sync,
  where proposals live.
- Open registration is capped at 25 clients a day (counted in D1) so a
  stranger cannot spend the KV free tier (1,000 writes a day) and block
  sign-ins; redirect URIs must be https or loopback.
- Notes in Kore Cloud are not end-to-end encrypted (as on GitHub today).
- ChatGPT mobile and Grok sign-in still to verify live.
- The Worker keeps no session and answers `initialize` for clients that
  send it; behavior with clients on the newest MCP revision is to verify live.
