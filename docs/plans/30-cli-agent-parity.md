# Plan 30 — CLI agent parity

**Status:** Design accepted 2026-09-05 (user decision: all three layers);
implementation in this wave.
**Outcome:** A coding agent working a Kore graph through the `reflect` CLI can
discover what exists (tags, schemas, notes, links), read a note's properties,
and write the structured things the app writes (properties, tags, task state,
appended content, typed rows) without ever hand-editing YAML.
**Navigation:** [Plan 14](14-cli-read-discovery.md) (the CLI this extends) ·
[TDR 0005](../decisions/0005-tag-types-and-collections.md) (collections) ·
[docs/cli.md](../cli.md) (the contract) · [STATE](../STATE.md).

## Why now

Plan 14 shipped a read/discovery CLI with two structural writes (`capture`,
`new`) and the rule "manual markdown edits are the write path". The installed
agent skill (`apps/desktop/src-tauri/skills/graph-skill.md`) therefore tells
agents to edit files directly for anything else. With collections as databases
(Plan 29) that instruction lands agents exactly where they fail: writing
frontmatter by hand, guessing property keys and types, and unable to find out
which tags or schemas exist at all.

This plan **reverses Plan 14's "no write CLI" decision by user decision on
2026-09-05**, bounded as below. The binary stays `reflect` (CLAUDE.md naming
rule); no `kore` alias.

## Scope

**In (three layers, each releasable alone):**

1. **Read completeness** — `info`, `tags`, `list`, `properties`, `links`.
2. **Structured writes** — `set`, `tag`, `untag`, `done`, `append`,
   `new --tag/--set/--stdin`, `capture --stdin`.
3. **Agent ergonomics** — near-miss hints on not-found, refreshed
   `graph-skill.md`, `docs/cli.md`.

**Out:** an MCP server (Plan 25 I20), semantic search (needs the embedding
model), delete/rename (destructive), whole-body rewrite (violates "never
overwrite"), a long-running server, editing prose in place.

## Invariants that do not move

- **Privacy.** `private: true` notes stay invisible and unwritable; every
  index-backed command re-checks the file on disk (`still_public_on_disk`).
- **stdout is data, stderr is talk.** `--json` shapes are stable; new fields
  may be added, none change meaning. Exit codes: 0 ok · 1 runtime · 2 usage ·
  3 not found/private/ambiguous · 4 index missing.
- **Writes never overwrite.** Every write is atomic (temp + rename) and
  changes only the bytes it is about: a frontmatter key's block, a trailing
  tag line, three marker characters, an appended block.
- **The app owns `id:`.** The CLI never mints or edits it.
- **Reserved keys are untouchable** through `set`: `id`, `title`, `aliases`,
  `private`, `pinned`, `gist`, `ignoredContacts`, `lore`, `properties`,
  `template`, `cover`, `icon` (`RESERVED_FRONTMATTER_KEYS`, `tag-type.ts`).
- **Parity discipline.** New read commands use SQL over tables the desktop
  already projects; no new parser beyond the frontmatter splice below.

## Architecture

Everything lives in `apps/cli` (crate `reflect-cli`). One new library module,
`frontmatter_write.rs`, plus one new command file per command under
`src/commands/`. Rejected: putting frontmatter writing in `crates/note-policy`
for sharing — the desktop writes frontmatter in TypeScript
(`upsertFrontmatter`); no second Rust consumer exists.

### Frontmatter writes: top-level key splice, then verify

The app preserves comments, key order, and quoting through the `yaml`
Document API. `saphyr` (already a dependency via `note-policy`) can only
re-emit a whole document, which would rewrite every key the agent did not
touch. So `frontmatter_write::patch(source, patch) -> Result<String>`:

1. `split_frontmatter` (note-policy). If there is a block, parse it with
   saphyr; a parse failure or non-mapping root is refused (exit 1,
   "refusing to update invalid YAML frontmatter"), like the app.
2. For each patch entry, locate the top-level line `key:` (column 0, key
   verbatim or single/double-quoted). Its block runs to the next line that
   starts at column 0 and is neither blank nor a `#` comment. Replace the
   block with the rendered value; a deletion removes the block; a missing
   key appends its rendered lines before the closing fence.
3. No block and a non-empty patch: create `---\n…\n---\n` before the body.
   Deleting the last key removes the block entirely (the app's rule).
4. Re-parse the result with saphyr and assert every patched key reads back
   as the intended scalar/list; otherwise refuse without writing.

Rendering (`Value` → YAML lines), the scalar subset the app writes:

| Value | Rendered |
|---|---|
| string | `key: text`; double-quoted (JSON escaping) when it starts with a YAML-special char, contains `: ` or ` #`, is empty, or reads as a number/bool/null |
| number | `key: 4.5` (finite; integers without `.0`) |
| bool | `key: true` |
| list of strings | `key:` then `  - item` per entry, each item quoted by the string rule |

### Typed coercion for `set` / `new --set`

The schema is the union of `tag_types.schema_json` for every tag the note
carries (from the index). Keys with a schema entry coerce by type; keys
without one write as strings. Mirrors `typedValueForText` and the property
editors (`apps/desktop/src/components/tags/`).

| Type | Input → value | Refused when |
|---|---|---|
| `text`, `url`, `email`, `phone`, `select`, `status` | string | `select`/`status` value outside declared `options` → warning on stderr, still written (the app tolerates it) |
| `number` | finite f64 | not a number |
| `rating` | integer 1–5 | outside range |
| `checkbox` | `true`/`false`/`yes`/`no`/`1`/`0` → bool | anything else |
| `date` | `YYYY-MM-DD`, calendar-valid | invalid date |
| `relation`, `person` | title → `[[Title]]` (already-bracketed input passes through) | — |
| `relations`, `multiselect`, `files` | comma-split, trimmed, empties dropped → list; `[[…]]` wrapping for `relations` | empty list |
| `created` | `YYYY-MM-DD` (agent may set it, like a CSV import) | invalid date |
| `updated`, `rollup`, `reverse`, `formula` | — | always: view-only |

`--unset key` deletes; `key=` (empty value) is a usage error, not a delete.
No index: `set` still works with string coercion and warns once.

## Commands

### Layer 1 — read completeness

`reflect info [--json]` — works without an index.

```jsonc
{ "root": "/…/graph", "cliVersion": "0.1.0",
  "index": { "present": true, "usable": true, "newerSchema": false, "stale": false, "staleFiles": 0 },
  "counts": { "notes": 120, "dailies": 300, "tags": 14 } }   // counts null when no index
```

`reflect tags [--json]` — index required (exit 4). Grouped on `tag_key`,
`min(tag)` as display casing (the `graph-stats.ts` facet), non-private
`note`/`daily` kinds, count desc then key.

```jsonc
{ "stale": false, "tags": [
  { "tag": "book", "count": 12, "typed": true, "definition": "tags/book.md" },
  { "tag": "idea", "count": 3, "typed": false, "definition": null } ] }
```

`reflect list [--tag T] [--kind daily|note] [--limit N=50] [--json]` — index
required. Newest first (`mtime DESC, path`), non-private, privacy re-checked
on disk, tags per note from `tags` grouped by `note_path`.

```jsonc
{ "stale": false, "notes": [
  { "path": "notes/dune.md", "title": "Dune", "kind": "note",
    "updatedAt": "2026-08-20T09:14:03Z", "tags": ["book"] } ] }
```

`reflect properties <note> [--json]` — file-only (no index needed): the
note's frontmatter with reserved keys stripped, typed the way the index
would store them (`extractNoteProperties`: scalars and lists of scalars;
objects/nulls skipped). Plus `aliases` and `pinned` as metadata, and
`tags` from the index when it is open. Human form: `key\tvalue` lines.

```jsonc
{ "path": "notes/dune.md", "title": "Dune", "aliases": [], "pinned": false,
  "tags": ["book"], "properties": { "author": "Herbert", "rating": 4 } }
```

`reflect links <note> [--json]` — index required. Outgoing wiki links from
`links WHERE source_path = ?1 AND kind = 'wiki'`, resolved through
`note_keys` (`target_key = key`) to a path when one exists; unresolved
targets keep `path: null`. Private resolved targets are dropped.

```jsonc
{ "path": "notes/dune.md", "stale": false, "links": [
  { "target": "Frank Herbert", "path": "notes/frank-herbert.md", "title": "Frank Herbert" },
  { "target": "Arrakis", "path": null, "title": null } ] }
```

### Layer 2 — structured writes

`reflect set <note> key=value… [--unset key]… [--json]` — resolve, refuse
private (exit 3), coerce per the table, splice, verify, atomic write.

```jsonc
{ "path": "notes/dune.md", "absolutePath": "/…", "set": { "rating": 4, "read": true }, "unset": ["draft"] }
```

`reflect tag <note> <tag> [--json]` — append `#tag` as a trailing line (the
`appendBodyTag` rule: one blank line after prose, none in an empty body,
frontmatter untouched; no-op when the body already carries the tag as a
word). A typed tag with `created` properties gets those stamped with today's
date, unless already present. `<tag>` must satisfy the tag grammar (letters,
digits, `-`, `_`, `/`; no leading `#` required).

```jsonc
{ "path": "notes/dune.md", "tag": "book", "added": true, "stamped": { "added": "2026-09-05" } }
```

`reflect untag <note> <tag> [--json]` — remove a standalone trailing line
that is exactly `#tag` (plus the blank line before it). When the tag only
appears inline in prose: exit 1, "tag is inline in the body — edit the note
to remove it". Not present: `removed: false`, exit 0.

`reflect done <text> [--in <note>] [--undo] [--json]` — index required. Match
open tasks (`--undo`: done tasks) by `text`: exact case-insensitive first,
else unique case-insensitive substring. Zero matches: exit 3. Several: exit 3
with each candidate as `path\ttext` on stderr. Then, in the file on disk,
find the unique line whose trimmed form equals the indexed `raw` after its
marker (`+ [ ] text` / `+ [x] text`); if the index offset still holds that
line use it, else the unique line match; ambiguous or missing: exit 1 "task
line no longer matches the index — reopen the graph in Kore". Splice only
the three marker characters.

```jsonc
{ "path": "daily/2026-09-05.md", "text": "Pay bill", "checked": true }
```

`reflect append <note> [text] [--stdin] [--json]` — append a markdown block:
the note's own line ending, one blank line between existing content and the
block, trailing newline. Daily targets may not exist yet (created); other
targets must. Text from the argument or stdin (exactly one required).

```jsonc
{ "path": "notes/dune.md", "absolutePath": "/…", "created": false, "bytesAppended": 42 }
```

`reflect new <title> [--tag T]… [--set k=v]… [--stdin] [--template t]` —
extends the existing command: body from stdin (or the template) under the
H1, then every `--tag` as trailing `#tag` lines, then `--set` values (and
`created` stamps of typed tags) spliced into frontmatter. Coercion uses the
union schema of the `--tag`s. Still no `id:`. JSON adds `"tags"` and
`"properties"`.

`reflect capture --stdin` — reads the item text from stdin; the one-line
collapse rule is unchanged.

### Layer 3 — agent ergonomics

- `show`/`path`/`open`/`set`/`tag`/`untag`/`append`/`properties`/`links` on
  a not-found note: stderr adds up to three near-miss titles from the index's
  title-prefix ranking ("did you mean: …") when the index is open.
- `graph-skill.md`: new command table; rules become "use `tags` and
  `properties` to learn the schema before writing", "never hand-edit
  frontmatter — use `set`", "`append` for content, `capture` for items",
  "`done` for tasks". The "edit the file directly" fallback stays only for
  in-place prose edits.
- `docs/cli.md`: every shape above, the coercion table, the exit-code
  additions.

## Implementation plan

Single-threaded, one PR per layer or one PR total; each task ends with
`cargo test -p reflect-cli`, `cargo fmt --all -- --check`, and
`cargo clippy -p reflect-cli --all-targets -- -D warnings` green. Tests are
integration tests in `apps/cli/tests/cli.rs` against the real binary and
fixture graphs (existing `Fixture` helpers; add `insert_tag`,
`insert_tag_type`, `insert_property`, `insert_link` helpers that mirror the
desktop projection), plus unit tests inside `frontmatter_write.rs`. Each
command gets its main path and one failure path (privacy, ambiguity, or
missing index), no more.

### Layer 1

1. **`commands/info.rs`** — `info` shape; test: no index → counts null,
   with index → counts and stale flag.
2. **`commands/tags.rs`** — test: counts, typed flag, private note excluded
   from counts.
3. **`commands/list.rs`** — test: `--tag` filter and ordering; private
   dropped after an on-disk flip.
4. **`commands/properties.rs`** — test: typed values and reserved keys
   stripped; private → exit 3.
5. **`commands/links.rs`** — test: resolved and unresolved targets; private
   target dropped.

### Layer 2

6. **`frontmatter_write.rs`** — unit tests: add key to no-block, update
   scalar keeping a neighbouring comment, replace a block list, delete the
   last key removes the block, quoted-string rule, invalid YAML refused.
7. **`commands/set.rs`** + `schema.rs` (shared schema lookup + coercion,
   moved out of `collection.rs`) — tests: typed coercion through a
   `tag_types` fixture, reserved key refused, private refused, view-only
   type refused.
8. **`commands/tag.rs`** (`tag` + `untag`) — tests: append with blank line,
   idempotent, `created` stamp, untag inline refused.
9. **`commands/done.rs`** — tests: exact match toggles only the marker,
   ambiguity exit 3, drifted line exit 1.
10. **`commands/append.rs`** + `--stdin` on `capture` — tests: block
    appended with one blank line, daily created, stdin path.
11. **`new` extensions** — test: `--tag` + `--set` produce frontmatter +
    trailing tags; created stamp.

### Layer 3

12. Near-miss hints (`commands/mod.rs` helper used by the resolving
    commands) — test: stderr lists a near title on exit 3.
13. `graph-skill.md`, `docs/cli.md`, `apps/cli/src/lib.rs` doc comment,
    `commands/mod.rs` doc comment; skill-template test in `skill.rs` still
    passes.
14. `docs/STATE.md` landing entry; `docs/planning-index.md` row.

## Acceptance

- Every command in this plan has a green integration test for its main path
  and one failure path; `pnpm check` untouched (no TypeScript changes).
- An agent following the refreshed skill can: list tags → read a schema →
  create a typed row with values → set a property → tick a task → append
  notes, with no direct file edits and no YAML written by hand.
- `docs/cli.md` and `graph-skill.md` describe exactly what ships.
