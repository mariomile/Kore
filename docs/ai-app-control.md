# AI app control — gap map

**Updated:** 2026-09-21.
**Ask (user, 2026-09-15):** "dall'AI dobbiamo poter modificare tutto dell'app,
come anche le icone" — the chat AI should be able to change the app itself, not
only the prose inside notes.

**Reconstruction note.** [STATE.md](STATE.md) cites this file as the gap map
behind the tag-icon slice, but the document was never committed; it lived only
in the project store. This is a rebuild from the code as it stands at
`9ee8d04` (v0.70.2), not a recovery of the original text. Only three slice
numbers survive on the record — **slice 1** (tag appearance, shipped),
**slice 2** (`set_tag_schema`), and **slice 7** (the CLI engines' skill) — all
three named in STATE's tag-icon entry. Everything else below is an inventory of
gaps, deliberately unnumbered: assigning an order is a user decision, not a
reconstruction.

## The rule this map applies

A surface is "AI-controllable" only when the model can **see the valid values**
before it writes. The tag-icon slice exists because it could not: the model
guessed `building-2` and `gavel`, names the app does not have, and the edits
silently did nothing. So every gap below has two halves — a way to *list* what
the surface accepts, and a way to *propose* a change the user accepts or
rejects. A writer without a listing is the failure mode, not a shortcut.

## What the chat AI can do today

Thirteen tools at `9ee8d04`, registered in
`packages/core/src/ai/chat/tools.ts` (the tag three in `tag-tools.ts`). Read
tools always available; write tools gated on `allowEdits` and refused on
`private: true` notes.

**Read:** `search_notes`, `list_recent_notes`, `list_daily_notes`,
`list_collection`, `list_tags`, `list_tag_icons`, `read_notes`, `read_assets`,
`open_web_page`, `read_web_page`.

**Propose (user accepts in chat, nothing written before):** `edit_note` (a body
hunk, reviewed as a diff), `set_note_property` (one frontmatter key),
`set_tag_icon` (slice 1).

Everything the model writes lands through the app's own writer for that surface
— `set_tag_icon` goes through `saveTagType`, the Configure-tag writer — so the
validation the UI enforces is not duplicated in the tool.

## What the CLI engines can do today

Claude Code, Codex and Cursor reach the graph through the `reflect` binary
([docs/cli.md](cli.md), [Plan 30](plans/30-cli-agent-parity.md)): read and
discovery (`info`, `tags`, `list`, `properties`, `links`, `search`, `show`,
`collection`, `backlinks`, `tasks`, `recent`, `today`, `path`, `open`) and
structured writes (`set`, `tag`, `untag`, `done`, `append`, `new`, `capture`).
Four bundled skills teach the formats
(`apps/desktop/src-tauri/skills/`: `graph`, `kore-markdown`, `kore-collections`,
`kore-agent-memory`).

That surface is the *vault*, not the app. No CLI command reaches a setting, a
view, a routine, or an icon.

## The gaps

### Supertag schema — slice 2 (named in STATE)

At `9ee8d04` the model can read a schema (`list_tags` returns typed
definitions) and change a tag's icon, but not its properties. A
`set_tag_schema` tool needs the 20 property types as a listable vocabulary and
the schema dialog's rename migration extracted out of the dialog into
`lib/tags`, behind the same propose-and-accept card as the icon. **In flight in
[PR #237](https://github.com/mariomile/Kore/pull/237)**; when that lands this
section closes and the tool count above goes to fourteen.

### The CLI engines cannot see the catalogs — slice 7 (named in STATE)

`kore-collections` documents the property types and the fence grammar; it says
nothing about icons (verified: no `icon` line anywhere in it). The 217-name catalog
is generated into core for the chat AI only
(`packages/core/src/tags/tag-symbol-catalog.gen.ts`), so a CLI engine writing
`tags/<name>.md` by hand is back to guessing exactly as the chat AI was.

### Settings

108 keys in `packages/core/src/settings/schema.ts` — editor typography and
behavior, sidebar layout, semantic search, transcription, asset description,
collection views, automations, agent profiles. None is reachable by any tool.
This is the largest single gap and the one closest to the user's literal ask.
It is also the one most in need of the see-before-write rule: a settings tool
without a typed listing of each key's accepted values writes garbage.

### Views and layout

Saved views (`collectionSavedViews`, `collectionActiveViewId`), the table's
group/sort/filter state, open tabs, panes and columns are all persisted
settings the user drives by gesture. Nothing reads or proposes them.

### Automations and agents

Routines are created only by the user
([roadmap](roadmap.md), automations principle: no default routines, ever). A
tool that *proposes* a routine — the user accepting it in chat being the
explicit creation — fits that principle and does not exist. Agent profiles,
shared memory and the skill install are likewise UI-only.

### Note lifecycle

`edit_note` patches a body; there is no create, rename, move or delete tool.
Create and rename are plausible with the same review card; delete is
destructive and should stay a gesture.

### Appearance beyond tags

Theme, accent, and the Craft-parity register ([Plan 28](plans/28-craft-parity.md))
are CSS and settings, not data. Out of scope until settings are reachable.

## Non-goals

- Anything Rust-backed that changes the app's capabilities rather than its
  configuration (watcher policy, index schema, the run lock). Those are
  capabilities; TypeScript owns policy, and the AI sits above policy.
- Writing without review. Every slice keeps the propose-then-accept contract
  from the note-patch card; `private: true` notes stay refused live, at write
  time, not at proposal time.

## Related

[STATE.md](STATE.md) · [roadmap](roadmap.md) ·
[TDR 0005](decisions/0005-tag-types-and-collections.md) ·
[Plan 30](plans/30-cli-agent-parity.md) · [docs/cli.md](cli.md)
