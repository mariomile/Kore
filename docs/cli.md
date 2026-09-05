# The `reflect` CLI

A small, self-contained read/discovery/write CLI over a Kore graph (Plan 14,
extended for agents by [Plan 30](plans/30-cli-agent-parity.md)). It reads
the graph's markdown files directly and opens `.reflect/index.sqlite`
strictly read-only — no running desktop app required. The index is refreshed
by the desktop app, never by the CLI. Markdown stays the source of truth and
the CLI's writes stay **structural**: each one changes exactly the bytes it
is about (an appended item or block, a new file claimed atomically, one
frontmatter key, one trailing tag line, one task marker) and nothing ever
overwrites a note.

```
reflect info               # graph root, index state, counts (never needs the index)
reflect tags               # every tag with its count and whether it is typed
reflect list               # notes newest first with tags (--tag, --kind)
reflect collection <tag>   # a typed tag's rows with their property values
reflect properties <note>  # a note's frontmatter properties, typed
reflect links <note>       # the wiki links a note makes, resolved
reflect today              # print today's daily note
reflect today --path       # its absolute path (works before the file exists)
reflect search <query>     # ranked full-text search over the index
reflect show <note>        # print a note by date, path, title, or alias
reflect path <note>        # resolve a note to its absolute path
reflect open <note>        # open a note in the app (reflect:// deep link)
reflect tasks              # the graph's open tasks (--all includes done)
reflect backlinks <note>   # the notes linking to a note
reflect recent             # the most recently updated notes, newest first
reflect capture <text>     # append a bullet to today's daily (--to any note, --stdin)
reflect append <note> <text>  # append a markdown block (--stdin)
reflect new <title>        # create notes/<slug>.md (--template, --tag, --set, --stdin)
reflect set <note> k=v…    # write frontmatter properties typed by the tag schemas
reflect tag <note> <tag>   # add a trailing #tag line (untag removes it)
reflect done <text>        # tick a task off by its text (--undo reopens)
```

Built from `apps/cli` (`cargo build -p reflect-cli`); bundled with the desktop
app as a Tauri sidecar (macOS: `Kore.app/Contents/MacOS/reflect`, Linux
`.deb`: `/usr/bin/reflect`). For local development:
`cargo install --path apps/cli`.

## Graph resolution

First match wins:

1. `--graph <path>` — must contain a `.reflect/` directory.
2. `$REFLECT_GRAPH` — same requirement.
3. The nearest ancestor of the current directory containing `.reflect/`
   (git-style walk-up).

There is deliberately no fallback to the desktop app's recent-graphs config:
the CLI stays deterministic for scripts and agents.

## Privacy

Notes with `private: true` frontmatter are **invisible through the CLI** — no
content, no paths, no search hits — and there is no flag that overrides this.
`search` filters them out; `show`/`today`/`path` print nothing to stdout,
explain on stderr, and exit `3`. The check reads the resolved file's own
frontmatter (never just the index row), so a stale index can't leak a
just-flagged note.

## Output contract

- **stdout carries only data** (note content, paths, or JSON); all warnings
  and errors go to stderr.
- `--json` emits the stable shapes below — they are the agent/scripting
  contract and are locked by tests (`apps/cli/tests/cli.rs`).

| Exit code | Meaning |
|---|---|
| 0 | success |
| 1 | runtime error (no graph, IO/SQL failure, a write that would not verify) |
| 2 | usage error, or a value a command cannot honour (bad type, reserved key, view-only property) |
| 3 | note or task not found, ambiguous, or private |
| 4 | search index missing or unusable (every index-backed command: `search`, `tasks`, `backlinks`, `recent`, `collection`, `tags`, `list`, `links`, `done`) |

A `<note>` that resolves to nothing prints up to three "did you mean" titles
on stderr (from the index, private notes excluded).

## Commands

### `reflect today [--path] [--json]`

Prints today's daily note (`daily/YYYY-MM-DD.md`, local timezone). File-only —
works with no index. A missing daily is exit `3`; with `--path` the would-be
path is printed even before the file exists (dailies are created lazily, so
this is how editors/scripts create them).

```jsonc
// reflect today --json
{
  "date": "2026-06-11",
  "path": "daily/2026-06-11.md",
  "absolutePath": "/…/graph/daily/2026-06-11.md",
  "title": "2026-06-11",
  "content": "…"
}
// reflect today --path --json adds "exists" and omits title/content:
{ "date": "…", "path": "…", "absolutePath": "…", "exists": false }
```

### `reflect search <query> [--limit N] [--json]`

Search over note titles and bodies, ranked like the app: exact, prefix, and
per-term title matches lead, followed by title-boosted bm25 matches. Title
and body terms match at word starts (`car` finds `Car log`, never `Oscar party`);
terms in scripts written without spaces (Japanese, Chinese, Korean, Thai, …)
match anywhere in the title, since FTS alone cannot see inside their
uninterrupted title runs. A partial query such as `authent migr` finds
`authentication migration`, and terms can match across the title and body; body
matches include snippets. Terms are matched literally (FTS5 operators in the
query have no special meaning); a term the tokenizer finds no word in, such as
a lone `-`, is ignored entirely. JSON results without a body match have an empty
snippet; title-prefix recall scores `0`, while tokenizer-normalized title matches
retain their bm25 score. Requires the index: if `.reflect/index.sqlite` is missing
the exit code is `4` — open the graph in Reflect to build it; the CLI never runs the
indexer. If files on disk diverge from the index (checked by mtime, then content
hash), a staleness warning goes to stderr and `"stale": true` is set — results
still return.

```jsonc
// reflect search "meeting notes" --json
{
  "query": "meeting notes",
  "stale": false,
  "results": [
    { "path": "notes/standup.md", "title": "Standup", "snippet": "…meeting notes…", "score": -1.94 }
  ]
}
```

### `reflect show <note> [--json]`

Resolves `<note>` and prints the raw markdown. Resolution order:

1. A calendar-valid `YYYY-MM-DD` → that daily note.
2. An explicit path (graph-relative like `notes/foo.md`, or absolute inside
   the graph).
3. A title match (case-insensitive, trimmed).
4. An alias match (from `aliases:` frontmatter, or a v1 subject-alias
   segment of a `//` title like `Charlotte MacCaw // Mum`).

Works with or without the index — when the index is missing, titles/aliases
are derived by scanning the files. Ambiguous matches resolve to the first path
alphabetically and list the others on stderr.

```jsonc
// reflect show "Project X" --json   ("date" is null for non-dailies)
{ "date": null, "path": "notes/project-x.md", "absolutePath": "…", "title": "Project X", "content": "…" }
```

### `reflect path <note> [--json]`

Same resolution, but prints only the absolute path — for piping into editors
and tools (`$EDITOR "$(reflect path 'Project X')"`). A `YYYY-MM-DD` argument
prints the would-be daily path even before the file exists.

```jsonc
// reflect path 2099-01-01 --json   ("date" only appears for dailies)
{ "date": "2099-01-01", "path": "daily/2099-01-01.md", "absolutePath": "…", "exists": false }
```

### `reflect open <note> [--print] [--json]`

Same resolution, then navigates the Reflect app there by handing the OS URL
opener the note's `reflect://` deep link ([docs/deep-links.md](deep-links.md)).
The URL prefers the most durable address the note has: the date form for
dailies (which need not exist yet — navigation creates them lazily), the
frontmatter `id` form when the note carries one (it survives renames), else
the graph-relative path form. The CLI never writes, so it does not mint ids —
"Copy deep link" in the app does that.

The URL is always printed to stdout; `--print` skips launching the opener —
the scriptable half. Private notes are refused (exit `3`) like every other
CLI surface, before their address leaks.

```jsonc
// reflect open "Project X" --json --print   ("date" only appears for dailies)
{ "path": "notes/project-x.md", "url": "reflect://note/01hzy3…", "launched": false }
```

### `reflect tasks [--all] [--limit N] [--json]`

Lists the graph's tasks (round `+ [ ]` checkboxes) from the index's tasks
projection — open ones by default, `--all` includes completed. Rows come back
grouped by source note in file order, each with the note's title and the
task's due date (the first calendar-valid `[[YYYY-MM-DD]]` link inside the
item). Like `search`, this requires the index (exit `4` when missing) and
re-checks each source note's own frontmatter, so a note flagged private after
the last index run never surfaces. A stale index warns on stderr and sets
`"stale": true`.

```jsonc
// reflect tasks --json
{
  "stale": false,
  "tasks": [
    { "path": "notes/project.md", "title": "Project X", "text": "pay bill", "checked": false, "dueDate": "2026-08-22" }
  ]
}
```

### `reflect backlinks <note> [--json]`

Lists the notes linking *to* a note, from the index's `backlinks` view — the
same resolution the app's Backlinks panel uses (ranked wiki-name joins with
exact-file-first fallback, templates excluded), grouped per linking note with
a link count and self-links excluded. `<note>` resolves like everywhere else
(date, path, title, alias); a private target is refused with exit `3`, and
each linking note's own frontmatter is re-checked on disk before it surfaces.
Requires the index (exit `4` when missing); a stale index warns and sets
`"stale": true`.

```jsonc
// reflect backlinks "Project X" --json
{
  "path": "notes/project-x.md",
  "title": "Project X",
  "stale": false,
  "backlinks": [
    { "path": "notes/standup.md", "title": "Standup", "count": 2 }
  ]
}
```

### `reflect recent [--limit N] [--json]`

The most recently updated notes, newest first (default limit 20), from the
index — templates excluded, private notes filtered with the same on-disk
re-check as every index-backed command. Requires the index (exit `4`).
`updatedAt` is an RFC 3339 UTC timestamp of the last indexed update.

```jsonc
// reflect recent --limit 2 --json
{
  "stale": false,
  "notes": [
    { "path": "daily/2026-08-20.md", "title": "2026-08-20", "updatedAt": "2026-08-20T09:14:03Z" }
  ]
}
```

### `reflect collection <tag> [--sort KEY] [--desc] [--limit N] [--json]`

A typed tag's collection (TDR 0005): the notes carrying `<tag>`, with the
property values the tag's schema declares. Requires the index (exit `4`); a
tag without a type is exit `3` — configure the tag in Reflect first. Private
notes are dropped entirely (row, title, and property values), with the same
on-disk re-check as every index-backed command. `--sort` orders by a property
key (missing values last; `--desc` flips the direction); unsorted rows come
pinned-first, then newest. Property values are typed JSON: numbers, booleans,
and lists round-trip as themselves, everything else as strings.

```jsonc
// reflect collection book --sort rating --desc --json
{
  "tag": "book",
  "stale": false,
  "schema": [
    { "name": "Author", "key": "author", "type": "text" },
    { "name": "Rating", "key": "rating", "type": "number" }
  ],
  "notes": [
    {
      "path": "notes/the-dispossessed.md",
      "title": "The Dispossessed",
      "properties": { "author": "Le Guin", "rating": 4.5 }
    }
  ]
}
```

### `reflect capture <text> [--stdin] [--task] [--to <note>] [--json]`

The CLI's item write: appends `<text>` (or stdin, with `--stdin`) as one list
item to today's daily note, or — with `--to` — to any note resolved the
usual way (date, path, title, alias). A daily target may not exist yet (dailies are lazy, and
capture creates them); any other target must. `--task` appends an open task
(`+ [ ] text`) instead of a plain bullet. The item joins a trailing bullet
list with the list's own marker (a task only joins a `+` list — the round
marker is what makes it a task); anything else gets a blank line and a fresh
list. Line breaks in `<text>` collapse to spaces, the write is atomic (temp
file + rename), and a `private: true` target is refused with exit `3` before
anything is read or written. stdout prints the target's absolute path. The
JSON `date` field appears only for daily targets.

```jsonc
// reflect capture --task "Pay bill" --json
{
  "date": "2026-08-20",
  "path": "daily/2026-08-20.md",
  "absolutePath": "/…/graph/daily/2026-08-20.md",
  "created": true,
  "item": "+ [ ] Pay bill"
}
```

### `reflect new <title> [--template <t>] [--tag <tag>]… [--set key=value]… [--stdin] [--json]`

Creates a regular note the way the app would: a title-derived filename
(`notes/<slug>.md` via the frozen slug rules, `-2` suffix on collision,
claimed with an atomic no-clobber create) and the H1 title in place. The CLI
mints no frontmatter `id:` — the app owns those. `--template` seeds the body
from a `templates/` file (matched by name or H1 title, case-insensitive)
with its frontmatter stripped and `{{date}}`/`{{date:iso}}`/`{{time}}`/
`{{title}}` expanded; a template that opens with its own H1 owns the note's
structure, otherwise the title leads. `--stdin` seeds the body from stdin
instead. A `private: true` template is refused (exit `3`) — copying its body
into a new public note would leak it.

With `--tag` the note is born as a collection row, like the table's "+ New":
each tag lands as a trailing `#tag` line; a typed tag's bound template seeds
the body when no `--template`/`--stdin` is given; its `created` properties
are stamped with today's date; and `--set` values are typed by the union of
the tags' schemas (the [`set`](#reflect-set-note-keyvalue-unset-key-json)
rules). stdout prints the new note's absolute path.

```jsonc
// reflect new "Left Hand of Darkness" --tag book --set rating=5 --json
{
  "path": "notes/left-hand-of-darkness.md",
  "absolutePath": "/…/graph/notes/left-hand-of-darkness.md",
  "title": "Left Hand of Darkness",
  "tags": ["book"],
  "properties": { "rating": 5, "added": "2026-09-05" }
}
```

### `reflect info [--json]`

The graph at a glance — the one index-backed command that never exits `4`:
an agent runs it first to learn what the others will be able to do. Counts
cover public notes and dailies and the distinct tags they carry; `counts`
is null when the index is absent or unusable.

```jsonc
// reflect info --json
{
  "root": "/…/graph",
  "cliVersion": "0.1.0",
  "index": { "present": true, "usable": true, "newerSchema": false, "stale": false, "staleFiles": 0 },
  "counts": { "notes": 120, "dailies": 300, "tags": 14 }
}
```

### `reflect tags [--json]`

Every tag with its public note count, grouped on the folded key with one
display casing (the app's tag facet), most used first. `typed` marks a
collection — a schema at `tags/<tag>.md` — whose columns
[`collection`](#reflect-collection-tag-sort-key-desc-limit-n-json) lists.
Requires the index (exit `4`).

```jsonc
// reflect tags --json
{
  "stale": false,
  "tags": [
    { "tag": "book", "count": 12, "typed": true, "definition": "tags/book.md" },
    { "tag": "idea", "count": 3, "typed": false, "definition": null }
  ]
}
```

### `reflect list [--tag <tag>] [--kind daily|note] [--limit N] [--json]`

Notes newest first with their tags, narrowed to one tag and/or one kind.
Requires the index (exit `4`); private notes are excluded with the same
on-disk re-check as `recent`.

```jsonc
// reflect list --tag book --kind note --json
{
  "stale": false,
  "notes": [
    { "path": "notes/dune.md", "title": "Dune", "kind": "note",
      "updatedAt": "2026-08-20T09:14:03Z", "tags": ["book"] }
  ]
}
```

### `reflect properties <note> [--json]`

A note's frontmatter as typed property values — the same typing the
`note_properties` projection stores (scalars and lists of scalars; objects,
nulls and the app's own keys such as `id`, `private`, `pinned`, `aliases`
are left out), read from the file itself so it is never stale. `aliases`
and `pinned` ride along as metadata; `tags` come from the index when it is
open (empty otherwise). File-only like `show`. A private note is refused
(exit `3`).

```jsonc
// reflect properties Dune --json
{
  "path": "notes/dune.md",
  "title": "Dune",
  "aliases": [],
  "pinned": false,
  "tags": ["book"],
  "properties": { "author": "[[Frank Herbert]]", "rating": 4, "genres": ["scifi", "classic"] }
}
```

### `reflect links <note> [--json]`

The wiki links a note makes, in document order, one entry per distinct
target, resolved through the index's link resolution to the note that
answers to it (`path: null` when none does). A private source is refused;
a link whose target is private is dropped. Requires the index (exit `4`).

```jsonc
// reflect links Dune --json
{
  "path": "notes/dune.md",
  "stale": false,
  "links": [
    { "target": "Frank Herbert", "path": "notes/frank-herbert.md", "title": "Frank Herbert" },
    { "target": "Arrakis", "path": null, "title": null }
  ]
}
```

### `reflect set <note> key=value… [--unset key]… [--json]`

Writes frontmatter property values the way the app's property editors do.
The value's type comes from the schemas of the tags the note carries (their
union; the first declaration of a key wins), so a `rating` column takes
`rating=4` as a number and refuses `rating=nine`. Keys no schema declares
are written as text; without an index everything is text (warned once).

| Schema type | `value` | Written as |
|---|---|---|
| `text`, `url`, `email`, `phone`, `select`, `status` | text | string (`select`/`status` warn when outside the declared options) |
| `number` | a finite number | number |
| `rating` | 1–5 | number |
| `checkbox` | `true`/`false`/`yes`/`no`/`1`/`0` | boolean |
| `date`, `created` | `YYYY-MM-DD`, calendar-valid | string |
| `relation`, `person` | a note title (or `[[link]]`) | `[[Title]]` |
| `relations` | comma-separated titles | list of `[[Title]]` |
| `multiselect`, `files` | comma-separated | list of strings |
| `updated`, `rollup`, `reverse`, `formula` | — | refused, computed by Kore (exit `2`) |

Reserved keys (`id`, `title`, `aliases`, `private`, `pinned`, `gist`,
`ignoredContacts`, `lore`, `properties`, `template`, `cover`, `icon`) are
refused (exit `2`); `--unset` removes a key. The block is patched one
top-level key at a time — every other line, comment and quoting stays as
written — then re-parsed and read back before the atomic write; a block
that is not valid YAML is refused untouched (exit `1`). A private note is
refused (exit `3`). stdout prints the note's absolute path.

```jsonc
// reflect set Dune rating=4 read=yes "author=Frank Herbert" --unset draft --json
{
  "path": "notes/dune.md",
  "absolutePath": "/…/graph/notes/dune.md",
  "set": { "rating": 4, "read": true, "author": "[[Frank Herbert]]" },
  "unset": ["draft"]
}
```

### `reflect tag <note> <tag> [--json]` · `reflect untag <note> <tag> [--json]`

Membership in a collection is the inline hashtag, so `tag` appends `#tag`
as a trailing body line (one blank line after prose, none in an empty body;
frontmatter untouched) exactly like the app's bulk-tag action, and is a
no-op when the body already carries the tag as a word. A typed tag's
`created` properties are stamped with today's date unless already present.
`untag` removes only such a standalone trailing line; a tag inside prose is
the user's text and is refused (exit `1`) — edit the note instead. The tag
must follow the tag grammar (a letter, then letters, digits, `/`, `_`, `-`;
the leading `#` is optional). Private notes are refused.

```jsonc
// reflect tag Dune book --json
{ "path": "notes/dune.md", "tag": "book", "added": true, "stamped": { "added": "2026-09-05" } }
// reflect untag Dune book --json
{ "path": "notes/dune.md", "tag": "book", "removed": true }
```

### `reflect done <text> [--in <note>] [--undo] [--json]`

Ticks a task off by its text: an exact (case-insensitive) match among the
graph's open tasks, else a unique substring match; `--in` narrows to one
note, `--undo` reopens a completed task. Zero or several matches exit `3`
(the candidates are listed on stderr). Requires the index (exit `4`) to
find the task; the file on disk is the truth for the write — the marker
line the index recorded must still be present exactly once (at its old
offset or moved), else the command refuses (exit `1`) rather than toggling
the wrong line. Only the three marker characters change.

```jsonc
// reflect done "pay bill" --in 2026-09-05 --json
{ "path": "daily/2026-09-05.md", "text": "pay bill", "checked": true }
```

### `reflect append <note> <text> [--stdin] [--json]`

Appends a markdown block — headings, paragraphs, lists — after one blank
line, in the note's own line ending. A daily target may not exist yet
(created); any other target must. Private targets are refused. Pipe longer
content with `--stdin`.

```jsonc
// printf '## Notes\n\n- one\n' | reflect append Dune --stdin --json
{ "path": "notes/dune.md", "absolutePath": "/…/graph/notes/dune.md", "created": false, "bytesAppended": 16 }
```

## For agents

The commands above plus `--json` are the supported automation surface (e.g.
`~/.agents` discovery workflows). The JSON field names and exit codes above
are stable; new fields may be added, existing ones won't change meaning.
Reading or writing a private note is not possible through this surface by
design — don't work around it by reading graph files directly unless the
user asked for that. The intended loop is discover → read → write:
`info`/`tags` to learn what exists, `collection`/`properties` to learn a
row's keys and types, then `new`/`set`/`tag`/`done`/`append` instead of
hand-written YAML.

Settings → Agents installs a per-graph agent skill
(`~/.agents/skills/reflect-<graph-slug>/SKILL.md`) that teaches coding agents
this contract: the graph's root, the bundled CLI's path, the commands, and
the privacy rules. The file carries a `reflect-managed` sha256 marker so the
app can refresh its own installs without ever overwriting a hand-edited one
(`apps/desktop/src-tauri/src/skill.rs`).

## Development notes

- The CLI deliberately duplicates a thin contract from `@reflect/core`
  (path conventions, fold keys, frontmatter coercions, title derivation,
  SHA-256 hashing, FTS match syntax, the tag grammar, property typing and
  coercion). Each Rust module names its TS counterpart, and the read-side
  contract is pinned by the shared parity corpus in
  [`fixtures/parity/`](../fixtures/parity/README.txt): TS generates
  `expected.json` from the real core pipeline, the Rust tests assert against
  it, so neither side can change without the other following in the same PR.
  The write side (`frontmatter_write.rs`, `schema.rs`, `body_tag.rs`) is
  pinned by its own unit tests against the app's serializer rules. Don't
  grow the surface beyond what an agent needs to avoid editing files by
  hand.
- The sidecar is staged by `apps/desktop/scripts/build-sidecar.mjs` into
  `apps/desktop/src-tauri/binaries/` (gitignored), which Tauri's
  `bundle.externalBin` (desktop platform overlay configs) picks up. tauri-build
  requires that file to exist before the desktop crate compiles — `pnpm tauri
  dev`/`build` stage it automatically; before a bare `cargo build/test
  --workspace`, run `pnpm --filter @reflect/desktop sidecar` once.
