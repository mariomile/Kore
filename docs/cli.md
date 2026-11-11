# The `kore` CLI

A small, self-contained read/discovery/write CLI over a Kore graph (Plan 14,
extended for agents by [Plan 30](plans/30-cli-agent-parity.md)). It reads
the graph's markdown files directly and opens `.kore/index.sqlite`
strictly read-only — no running desktop app required. The index is refreshed
by the desktop app, or without it by `kore index`, which runs the app's own
indexer under Node (see below). Markdown stays the source of truth and
the CLI's writes stay **structural**: each one changes exactly the bytes it
is about (an appended item or block, a new file claimed atomically, one
frontmatter key, one trailing tag line, one task marker, one passage whose
exact current text the caller passed) and nothing ever overwrites a note.

```
kore info                  # graph root, index state, counts (never needs the index)
kore tags                  # every tag with its count and whether it is typed
kore list                  # notes newest first with tags (--tag, --kind)
kore collection <tag>      # a typed tag's rows with their property values
kore properties <note>     # a note's frontmatter properties, typed
kore links <note>          # the wiki links a note makes, resolved
kore explain <note>        # properties, tags, outline, links and backlinks in one call
kore route <from> <to>     # the shortest chain of links between two notes
kore grep <text>           # every line containing an exact text (no index needed)
kore skills [name]         # the vault's agent skills (agents/skills/), or one in full
kore active                # the note open in the app and the note tabs beside it
kore today                 # print today's daily note
kore today --path          # its absolute path (works before the file exists)
kore search <query>        # words + meaning, like the app's AI chat (--mode lexical|semantic)
kore show <note>           # print a note by date, path, id, title, or alias
kore path <note>           # resolve a note to its absolute path
kore open <note>           # open a note in the app (kore:// deep link)
kore tasks                 # the graph's open tasks (--all includes done)
kore backlinks <note>      # the notes linking to a note
kore recent                # the most recently updated notes, newest first
kore capture <text>        # append a bullet to today's daily (--to any note, --stdin)
kore append <note> <text>     # append a markdown block (--stdin)
kore edit <note> --old T --new T  # replace one exact passage (empty --old appends)
kore new <title>           # create notes/<slug>.md (--template, --tag, --set, --stdin)
kore set <note> k=v…       # write frontmatter properties typed by the tag schemas
kore tag <note> <tag>      # add a trailing #tag line (untag removes it)
kore done <text>           # tick a task off by its text (--undo reopens)
kore mcp                   # serve the graph to MCP clients over stdio (--read-only, --memory-only, --http <addr>)
kore brain                 # write memory through the vault's cyber-brain script (status, trust, remember, loop, decision)
kore index                 # build or refresh the index without the app (Node 22+, --rebuild)
kore sources               # pull Readwise highlights and Granola meetings without the app (--only, --since)
kore keys add <name>       # a named agent's own key for mcp --http (--write or --propose; list, remove)
kore proposals             # writes from --propose keys waiting for you (accept <id>, reject <id>)
kore sync                  # pull the vault's git clone, push kore's writes, reindex (what mcp --sync does; --sources pulls them too)
kore library               # read-only Markdown in agent folders like ~/.claude (add --known, files, grep, read)
```

Built from `apps/cli` (`cargo build -p kore-cli`); bundled with the desktop
app as a Tauri sidecar (macOS: `Kore.app/Contents/MacOS/kore`, Linux
`.deb`: `/usr/bin/kore`). For local development:
`cargo install --path apps/cli`.

## Graph resolution

First match wins:

1. `--graph <path>` — must contain a `.kore/` directory.
2. `$KORE_GRAPH` — same requirement.
3. The nearest ancestor of the current directory containing `.kore/`
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

Titles and aliases resolve through the index when it is open and fall back
to a scan of the files on a miss, so a note created a moment ago resolves
before the app re-indexes. A `<note>` that resolves to nothing prints up to
three "did you mean" titles on stderr (from the index, private notes
excluded).

## Commands

### `kore today [--path] [--json]`

Prints today's daily note (`daily/YYYY-MM-DD.md`, local timezone). File-only —
works with no index. A missing daily is exit `3`; with `--path` the would-be
path is printed even before the file exists (dailies are created lazily, so
this is how editors/scripts create them).

```jsonc
// kore today --json
{
  "date": "2026-06-11",
  "path": "daily/2026-06-11.md",
  "absolutePath": "/…/graph/daily/2026-06-11.md",
  "title": "2026-06-11",
  "content": "…"
}
// kore today --path --json adds "exists" and omits title/content:
{ "date": "…", "path": "…", "absolutePath": "…", "exists": false }
```

### `kore search <query> [--limit N] [--mode hybrid|lexical|semantic] [--json]`

Hybrid by default, the same search the in-app AI chat's `search_notes` runs
(`retrieve()` in `packages/core/src/embeddings/retrieve.ts`): the lexical
ranking below fused by reciprocal rank (K = 60) with semantic neighbors, so a
plain-language question ("what did I decide about pricing") finds notes that
discuss it without its exact words. The semantic leg embeds the query with
the app's own model (all-MiniLM-L6-v2, read from the app's model cache, or
`$KORE_MODEL_DIR`; the CLI never downloads it), runs a KNN over the chunk
vectors the app stored in `embedding_chunks`, drops neighbors past cosine
distance 0.7 and keeps each note's best chunk. Search filters constrain both
legs. Before it trusts the model, the CLI re-embeds one stored chunk and
compares it with the app's vector; below 0.99 cosine, semantic search stays
off. When the app has no vectors (semantic search off in Settings → AI), the
model is not on this machine, or that check fails, hybrid serves lexical
results only, says why on stderr, and reports it in `semanticUnavailable`.
`--mode lexical` runs the lexical leg alone; `--mode semantic` the semantic
leg alone, and fails (exit `1`) when it is unavailable. `mode` in the JSON
names the legs that ran. The model runs on `tract`, a pure-Rust ONNX runtime,
so the binary needs no native library.

The lexical leg searches note titles and bodies, ranked like the app: exact, prefix, and
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
retain their bm25 score. Requires the index: if `.kore/index.sqlite` is missing
the exit code is `4` — open the graph in Reflect to build it; the CLI never runs the
indexer. If files on disk diverge from the index (checked by mtime, then content
hash), a staleness warning goes to stderr and `"stale": true` is set — results
still return.

The query speaks the same filter grammar as the app's search palette, so a
query typed in either place returns the same notes:

| Operator | Meaning |
| --- | --- |
| `#tag`, `tag:#tag`, `tag:tag` | carries the tag, nested tags included (`#type` finds `#type/person`) |
| `-#tag`, `-tag:x` | does not carry the tag (or a nested one) |
| `"exact phrase"` | the words in this order, in the title or body |
| `-word`, `-"phrase"` | the title and body do not contain it |
| `path:CRM/`, `-path:x` | the vault path contains (or does not contain) the text, case-insensitively; quote spaces: `path:"Active Projects"` |
| `file:name`, `-file:x` | the file name contains (or does not contain) the text |
| `[key]`, `[key:value]`, `prop:key`, `prop:key=value` | the frontmatter property exists, or equals the value case-insensitively (a list entry and a `[[value]]` relation match too) |
| `is:daily`, `is:pinned` | daily notes only, pinned notes only |
| `links:Note`, `linked-from:Note` | links to, or is linked from, the note (resolved like a `[[Note]]` link, then like `show`); a target that names no note matches nothing, and a private one is refused (exit `3`) |
| `updated:>YYYY-MM-DD`, `updated:<…`, `updated:…` | modified on or after, before, or during the local day |

A half-formed token (`path:` with no value, an impossible date, `#123`) stays
search text. A query of filters alone, such as `kore search "tag:#type/person
path:CRM/"`, lists the matching notes newest first, with empty snippets and
score `0`. Quote the whole query in the shell so `#` and `"` reach the CLI.

```jsonc
// kore search "meeting notes" --json
{
  "query": "meeting notes",
  "stale": false,
  "mode": "hybrid",
  "results": [
    { "path": "notes/standup.md", "title": "Standup", "snippet": "…meeting notes…", "score": 0.0328 },
    { "path": "notes/retro.md", "title": "Retro", "snippet": "What we agreed in the sync…", "heading": "Decisions", "score": 0.0161 }
  ]
}
// Scores: hybrid = fused rank score (higher is better), lexical = bm25 (more
// negative is better, 0 for title recall), semantic = cosine similarity.
// "heading" is the heading above a semantic match's passage.
// Without semantic search: "mode": "lexical", "semanticUnavailable": "<why>".
```

### `kore show <note> [--json]`

Resolves `<note>` and prints the raw markdown. Resolution order:

1. A calendar-valid `YYYY-MM-DD` → that daily note.
2. An explicit path (graph-relative like `notes/foo.md`, or absolute inside
   the graph).
3. A frontmatter `id` (the form the app's "Copy deep link" puts in
   `kore://note/<id>`), when the index is open.
4. A title match (case-insensitive, trimmed).
5. An alias match (from `aliases:` frontmatter, or a v1 subject-alias
   segment of a `//` title like `Charlotte MacCaw // Mum`).

Works with or without the index — when the index is missing, titles/aliases
are derived by scanning the files. Ambiguous matches resolve to the first path
alphabetically and list the others on stderr.

```jsonc
// kore show "Project X" --json   ("date" is null for non-dailies)
{ "date": null, "path": "notes/project-x.md", "absolutePath": "…", "title": "Project X", "content": "…" }
```

### `kore path <note> [--json]`

Same resolution, but prints only the absolute path — for piping into editors
and tools (`$EDITOR "$(kore path 'Project X')"`). A `YYYY-MM-DD` argument
prints the would-be daily path even before the file exists.

```jsonc
// kore path 2099-01-01 --json   ("date" only appears for dailies)
{ "date": "2099-01-01", "path": "daily/2099-01-01.md", "absolutePath": "…", "exists": false }
```

### `kore open <note> [--print] [--json]`

Same resolution, then navigates the Reflect app there by handing the OS URL
opener the note's `kore://` deep link ([docs/deep-links.md](deep-links.md)).
The URL prefers the most durable address the note has: the date form for
dailies (which need not exist yet — navigation creates them lazily), the
frontmatter `id` form when the note carries one (it survives renames), else
the graph-relative path form. The CLI never writes, so it does not mint ids —
"Copy deep link" in the app does that.

The URL is always printed to stdout; `--print` skips launching the opener —
the scriptable half. Private notes are refused (exit `3`) like every other
CLI surface, before their address leaks.

```jsonc
// kore open "Project X" --json --print   ("date" only appears for dailies)
{ "path": "notes/project-x.md", "url": "kore://note/01hzy3…", "launched": false }
```

### `kore tasks [--all] [--limit N] [--json]`

Lists the graph's tasks (round `+ [ ]` checkboxes) from the index's tasks
projection — open ones by default, `--all` includes completed. Rows come back
grouped by source note in file order, each with the note's title and the
task's due date (the first calendar-valid `[[YYYY-MM-DD]]` link inside the
item). Like `search`, this requires the index (exit `4` when missing) and
re-checks each source note's own frontmatter, so a note flagged private after
the last index run never surfaces. A stale index warns on stderr and sets
`"stale": true`.

```jsonc
// kore tasks --json
{
  "stale": false,
  "tasks": [
    { "path": "notes/project.md", "title": "Project X", "text": "pay bill", "checked": false, "dueDate": "2026-08-22" }
  ]
}
```

### `kore backlinks <note> [--json]`

Lists the notes linking *to* a note, from the index's `backlinks` view — the
same resolution the app's Backlinks panel uses (ranked wiki-name joins with
exact-file-first fallback, templates excluded), grouped per linking note with
a link count and self-links excluded. `<note>` resolves like everywhere else
(date, path, title, alias); a private target is refused with exit `3`, and
each linking note's own frontmatter is re-checked on disk before it surfaces.
Requires the index (exit `4` when missing); a stale index warns and sets
`"stale": true`.

```jsonc
// kore backlinks "Project X" --json
{
  "path": "notes/project-x.md",
  "title": "Project X",
  "stale": false,
  "backlinks": [
    { "path": "notes/standup.md", "title": "Standup", "count": 2 }
  ]
}
```

### `kore recent [--limit N] [--json]`

The most recently updated notes, newest first (default limit 20), from the
index — templates excluded, private notes filtered with the same on-disk
re-check as every index-backed command. Requires the index (exit `4`).
`updatedAt` is an RFC 3339 UTC timestamp of the last indexed update.

```jsonc
// kore recent --limit 2 --json
{
  "stale": false,
  "notes": [
    { "path": "daily/2026-08-20.md", "title": "2026-08-20", "updatedAt": "2026-08-20T09:14:03Z" }
  ]
}
```

### `kore collection <tag> [--sort KEY] [--desc] [--limit N] [--json]`

A typed tag's collection (TDR 0005): the notes carrying `<tag>`, with the
property values the tag's schema declares. Requires the index (exit `4`); a
tag without a type is exit `3` — configure the tag in Reflect first. Private
notes are dropped entirely (row, title, and property values), with the same
on-disk re-check as every index-backed command. `--sort` orders by a property
key (missing values last; `--desc` flips the direction); unsorted rows come
pinned-first, then newest. Property values are typed JSON: numbers, booleans,
and lists round-trip as themselves, everything else as strings.

```jsonc
// kore collection book --sort rating --desc --json
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

### `kore capture <text> [--stdin] [--task] [--to <note>] [--json]`

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
// kore capture --task "Pay bill" --json
{
  "date": "2026-08-20",
  "path": "daily/2026-08-20.md",
  "absolutePath": "/…/graph/daily/2026-08-20.md",
  "created": true,
  "item": "+ [ ] Pay bill"
}
```

### `kore new <title> [--template <t>] [--tag <tag>]… [--set key=value]… [--stdin] [--json]`

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
the tags' schemas (the [`set`](#kore-set-note-keyvalue-unset-key-json)
rules). stdout prints the new note's absolute path.

```jsonc
// kore new "Left Hand of Darkness" --tag book --set rating=5 --json
{
  "path": "notes/left-hand-of-darkness.md",
  "absolutePath": "/…/graph/notes/left-hand-of-darkness.md",
  "title": "Left Hand of Darkness",
  "tags": ["book"],
  "properties": { "rating": 5, "added": "2026-09-05" }
}
```

### `kore info [--json]`

The graph at a glance — the one index-backed command that never exits `4`:
an agent runs it first to learn what the others will be able to do. Counts
cover public notes and dailies and the distinct tags they carry; `counts`
is null when the index is absent or unusable.

```jsonc
// kore info --json
{
  "root": "/…/graph",
  "cliVersion": "0.1.0",
  "index": { "present": true, "usable": true, "newerSchema": false, "stale": false, "staleFiles": 0 },
  "counts": { "notes": 120, "dailies": 300, "tags": 14 }
}
```

### `kore cloud setup | upload | key | token-url`

Kore Cloud (Plan 34): the vault always on for every agent, in the user's own
Cloudflare account on the free plan. Kore runs nothing: the Worker, the
database and the keys live in that account.

- `kore cloud setup [--account <id>] [--name <worker>]` prints Cloudflare's
  token page with the permissions prefilled (Workers Scripts, D1 and Workers
  KV edit, Account Settings read), takes the pasted token without echoing
  it (or `KORE_CLOUDFLARE_TOKEN`), then creates or finds the `kore` D1
  database and the `kore-oauth` and `kore-pages` KV namespaces, uploads the
  Worker with the vault's layout from `.obsidian/`, turns on its
  `*.workers.dev` URL and uploads the notes. The token is never stored.
  Running it again updates the Worker in place and keeps the owner key.
- `kore cloud upload` sends the notes Kore Cloud lacks. It never overwrites
  a note already there with other text (it reports it); private notes,
  hidden folders and notes over 1 MB stay local.
- `kore cloud key` prints the owner key, which approves each agent on Kore
  Cloud's sign-in page (`<url>/mcp` is the connector URL).
- The URL and owner key live in `$KORE_CLOUD_FILE`, else
  `$XDG_CONFIG_HOME/kore/cloud.json`, else `~/.config/kore/cloud.json`
  (mode 0600, outside the vault).
- Needs Node 22 (`KORE_NODE`) and `kore-cloud.mjs` next to the `kore`
  binary, or its path in `KORE_CLOUD_SCRIPT`. Build it with
  `pnpm --filter @kore/cloud build:setup` (it lands in `apps/cloud/dist/`).

### `kore index [--rebuild] [--json]`

Builds or refreshes `.kore/index.sqlite` with no app running, so every
index-backed command (and `kore mcp`) works on a plain clone of a vault, for
example on an always-on server that pulls the vault from GitHub. It is the
app's projection, not a copy: `kore` spawns Node on `kore-indexer.mjs`, the
`@kore/core` indexer bundled into one script, and serves its file reads
and index writes with the same Rust code the app uses
(`crates/index-store`).

- The first run on a folder indexes every note; an explicit `--graph` or
  `$KORE_GRAPH` folder may lack `.kore/` (it is created). Later runs
  reconcile and read only files whose mtime moved, so
  `git pull && kore index` is cheap. `--rebuild` rewrites every row.
- Needs Node 22 or later (`KORE_NODE` names another binary) and
  `kore-indexer.mjs` next to the `kore` binary, or its path in
  `KORE_INDEXER`. Build it with `pnpm --filter @kore/core build:indexer`
  (it lands in `packages/core/dist/`).
- Not done here: embeddings. Semantic vectors are still computed by the app;
  a headless index answers lexical search, tags, backlinks, lists and tasks.
- Do not run it on a graph the app has open: both would write the same file.
- Exits `0` when the index is current, `1` on failure. Notes that fail to
  read or parse are named on stderr and the run still exits `0`; the next
  run retries them.

```jsonc
// kore index --json
{ "notes": 5155, "written": 2, "removed": 1, "moved": 0, "elapsedMs": 270 }
```

### `kore sources [--only readwise|granola] [--since WHEN] [--json]`

Pulls Readwise highlights and Granola meetings into the graph with no app
running, through the same connector engine the app runs every fifteen
minutes, hosted under Node like `kore index` (same `KORE_NODE` and
`KORE_INDEXER`). It indexes first, so it recognizes notes already there,
and again afterwards, so what it wrote is searchable at once.

- Tokens come only from the environment: `KORE_READWISE_TOKEN`
  (readwise.io/access_token) and `KORE_GRANOLA_TOKEN` (Granola's personal API
  key). A source without one is skipped; neither set is a usage error.
- Where notes land and what they carry is yours, per source, the same three
  settings the app has under Settings → Connectors:
  - `KORE_<SOURCE>_FOLDER`: the folder (defaults `Readwise`, `Granola`);
  - `KORE_<SOURCE>_PATTERN`: the file name inside it, where `/` makes
    subfolders and `{field}` inserts a value. Readwise offers `{title}`,
    `{category}`, `{author}` (default `{title}`); Granola `{title}`,
    `{date}`, `{month}`, `{year}` (default `{date} {title}`). For example
    `{category}/{title}` or `{month}/{title}, {date}`;
  - `KORE_<SOURCE>_TAGS`: comma-separated tags for new notes (defaults
    `readwise`, `meeting`).
- A vault that already holds notes from another sync gets no duplicates: a
  Granola meeting is matched by `granola_id` wherever it sits, and a Readwise
  file at the book's path is adopted (same `url`, or a Readwise cover or
  link); only highlights it lacks are appended, under
  `### New highlights added <date>`.
- Each source's window lives in `.kore/sources.json` (per machine, never
  committed). The first run starts from that moment, so history another app
  already wrote is not imported; `--since YYYY-MM-DD` reaches back further.
- On an always-on host, `kore sync --sources` runs it as a journaled write
  and pushes the commit (see [always-on.md](always-on.md)).
- Exits `1` when a source fails (named on stderr); the others still land.

```jsonc
// kore sources --json
{ "sources": [
  { "id": "readwise", "created": 1, "updated": 3, "syncedAt": "2026-11-07T17:30:10.204Z" },
  { "id": "granola", "created": 2, "updated": 0, "syncedAt": "2026-11-07T17:30:10.254Z" }
] }
```

### `kore guide [--init] [--json]`

What an agent reads first, before it touches the graph: the vault's own
agent contract and a map of where the notes are. Needs no index.

The contract is the first of `AGENTS.md`, `CLAUDE.md` at the graph root
that exists: the user's own file, the rules every agent follows (where
memory, decisions and new notes go, what not to touch). An agent working
on a git clone of the vault reads the same file directly, so both paths
give identical rules. A contract marked `private: true` is withheld
(`contract` is null) and the lookup stops there. Text past 20,000
characters is cut and `truncated` is true.

The map counts every public note per top-level folder, lists each folder's
eight largest subfolders, and spells where a daily note goes. Private notes
are left out of every count, so a folder holding only private notes is not
named.

```jsonc
// kore guide --json
{
  "contract": { "path": "AGENTS.md", "text": "# Agent contract\n…", "truncated": false },
  "map": {
    "notes": 5165, "rootNotes": 2, "dailyPattern": "Journal/Daily/YYYY-MM-DD.md",
    "folders": [{ "path": "CRM", "notes": 410, "folders": [{ "path": "CRM/People", "notes": 300 }] }]
  }
}
```

`--init` writes a starter `AGENTS.md` (Kore's conventions plus the map) when
the vault has no contract, and a `CLAUDE.md` that imports it (`@AGENTS.md`)
when `AGENTS.md` exists and `CLAUDE.md` does not. It never overwrites a
file; `--json` reports `{ "written": [...] }`.

### `kore brain [status | trust | <kit command> --option=value…] [--json]`

Memory writes through the vault's own cyber-brain kit (Plan 35), for a
vault whose `AGENTS.md` frontmatter declares `cyber_brain:`. The arguments
are the kit's own (`brain.mjs --help`): `kore brain remember --kind=fact
--text=… --source=…`, `loop open|update|close`, `decision new`, `check`.
Only those commands pass, every value goes inline as `--option=value`,
and Kore signs the run record with the calling agent (`--agent` from the
caller is dropped). Reads such as `facts` stay out: they print lines from
private notes too.

The script runs only once the user allowed its exact content: `kore brain
trust` (or Settings → Agents → Memory) records the digest of the whole
scripts folder in `.kore/kit-trust.json`, and any edit, including one
that arrives by sync, takes the permission back. `kore brain` alone
reports the kit and whether its script is `trusted`, `new` or `changed`.
Node 18 or newer must be installed; without it nothing is written.

```jsonc
// kore brain remember --kind=fact --text="Alice runs pricing" --source="call" --json
{ "ok": true, "output": "stored fact: Alice runs pricing -> CRM/People/Alice.md (commit 0ff9c38)", "commit": "0ff9c38" }
```

### `kore tags [--json]`

Every tag with its public note count, grouped on the folded key with one
display casing (the app's tag facet), most used first. `typed` marks a
collection — a schema at `tags/<tag>.md` — whose columns
[`collection`](#kore-collection-tag-sort-key-desc-limit-n-json) lists.
Requires the index (exit `4`).

```jsonc
// kore tags --json
{
  "stale": false,
  "tags": [
    { "tag": "book", "count": 12, "typed": true, "definition": "tags/book.md" },
    { "tag": "idea", "count": 3, "typed": false, "definition": null }
  ]
}
```

### `kore list [--tag <tag>] [--kind daily|note] [--limit N] [--json]`

Notes newest first with their tags, narrowed to one tag and/or one kind.
Requires the index (exit `4`); private notes are excluded with the same
on-disk re-check as `recent`.

```jsonc
// kore list --tag book --kind note --json
{
  "stale": false,
  "notes": [
    { "path": "notes/dune.md", "title": "Dune", "kind": "note",
      "updatedAt": "2026-08-20T09:14:03Z", "tags": ["book"] }
  ]
}
```

### `kore properties <note> [--json]`

A note's frontmatter as typed property values — the same typing the
`note_properties` projection stores (scalars and lists of scalars; objects,
nulls and the app's own keys such as `id`, `private`, `pinned`, `aliases`
are left out), read from the file itself so it is never stale. `aliases`
and `pinned` ride along as metadata; `tags` come from the index when it is
open (empty otherwise). File-only like `show`. A private note is refused
(exit `3`).

```jsonc
// kore properties Dune --json
{
  "path": "notes/dune.md",
  "title": "Dune",
  "aliases": [],
  "pinned": false,
  "tags": ["book"],
  "properties": { "author": "[[Frank Herbert]]", "rating": 4, "genres": ["scifi", "classic"] }
}
```

### `kore links <note> [--json]`

The wiki links a note makes, in document order, one entry per distinct
target, resolved through the index's link resolution to the note that
answers to it (`path: null` when none does). A private source is refused;
a link whose target is private is dropped. Requires the index (exit `4`).

```jsonc
// kore links Dune --json
{
  "path": "notes/dune.md",
  "stale": false,
  "links": [
    { "target": "Frank Herbert", "path": "notes/frank-herbert.md", "title": "Frank Herbert" },
    { "target": "Arrakis", "path": null, "title": null }
  ]
}
```

### `kore explain <note> [--json]`

One note's place in the graph in a single call: title, aliases, tags, typed
properties, word count, its headings in order (`outline`, fenced code
skipped), and the `links`/`backlinks` arrays exactly as those two commands
return them. A private note is refused; private neighbors are dropped.
Requires the index (exit `4`).

### `kore route <from> <to> [--max-hops N] [--json]`

The shortest chain of wiki links joining two notes, followed in either
direction (default limit 6 links). Each step names the note and its
`direction`: `links` when the previous note links to it, `linkedFrom` when it
links to the previous note. A route never passes through a private note,
even when that would be shorter. No route is exit `3` in text mode and
`"found": false` with `--json`. Requires the index (exit `4`).

```jsonc
// kore route Ada Plan --json
{
  "from": { "path": "notes/Ada.md", "title": "Ada" },
  "to": { "path": "notes/Plan.md", "title": "Plan" },
  "found": true, "hops": 2, "stale": false,
  "steps": [
    { "path": "notes/Acme.md", "title": "Acme", "direction": "links" },
    { "path": "notes/Plan.md", "title": "Plan", "direction": "linkedFrom" }
  ]
}
```

### `kore grep <text> [-i] [--limit N] [--json]`

Every line, in every note on disk, that contains the text literally, with
its 1-based line number (frontmatter counts). For the cases ranked `search`
cuts short: every task naming a person, every mention of an amount. `-i`
ignores case; `--limit` (default 200) stops early and sets `truncated`.
Walks the files, so it never needs the index. Private notes and iCloud
placeholders are skipped.

### `kore skills [name] [--json]`

The procedures the user taught their agents, one file each under
`agents/skills/<slug>.md` (H1 = name, frontmatter `description` = when to use
it). Without a name: every skill's `name` (the slug), `path`, `title` and
`description`. With a name (slug or title, any case): the whole file, or
`content` with `--json`. Private skills are neither listed nor served.

### `kore active [--json]`

The note in the Kore app's focused tab (`activeNote`, null when that tab is
not a note) and the open note tabs in order (`openNotes`), from
`.kore/workspace.json`, which the desktop app rewrites as tabs change.
Private, deleted and not-yet-downloaded notes are left out. Exit `3` when
the app has not written the file for this graph.

### `kore library [sources|add|remove|files|grep|read] [--json]`

The Library: folders outside the vault that the user's agents keep their own
Markdown in (`~/.claude`, `~/.codex`, `~/.agents`, `~/.gemini`, `~/.cursor`,
`~/.copilot`, `~/.config/opencode`), read-only, so one agent can find the
rules, skills and memory files another agent wrote. Needs no graph: the list
lives in `$KORE_LIBRARIES_FILE`, else `$XDG_CONFIG_HOME/kore/libraries.json`,
else `~/.config/kore/libraries.json`.

```bash
kore library add --known          # every agent home above that exists in $HOME
kore library add ~/notes/prompts --name prompts
kore library                      # name, Markdown file count, folder
kore library files [name]         # claude/CLAUDE.md, claude/skills/x/SKILL.md, ...
kore library grep <text> [-i] [--source name] [--limit N]
kore library read claude/CLAUDE.md
kore library remove prompts       # stops reading it; the files are untouched
```

Only `.md` files are listed or read, never configs (`settings.json`,
`config.toml`, `.claude.json` hold tokens), never hidden folders or the
transcript and cache folders (`projects`, `sessions`, `todos`, `logs`,
`node_modules`, ...), never through a symlink, never a file over 512 KB.
`read` refuses any path `files` would not list. Nothing is ever written to
these folders.

### `kore set <note> key=value… [--unset key]… [--json]`

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
refused (exit `2`); `--unset` removes a key (naming a key in both is exit
`2`). The block is patched one top-level key at a time — every other line,
comment and quoting stays as written; a `# comment` on the patched line
itself goes with the old value — then re-parsed and every patched key read
back before the atomic write. A block that is not valid YAML, or one the
patch would leave unparseable, is refused untouched (exit `1`). A private
note is refused (exit `3`). stdout prints the note's absolute path.

```jsonc
// kore set Dune rating=4 read=yes "author=Frank Herbert" --unset draft --json
{
  "path": "notes/dune.md",
  "absolutePath": "/…/graph/notes/dune.md",
  "set": { "rating": 4, "read": true, "author": "[[Frank Herbert]]" },
  "unset": ["draft"]
}
```

### `kore tag <note> <tag> [--json]` · `kore untag <note> <tag> [--json]`

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
// kore tag Dune book --json
{ "path": "notes/dune.md", "tag": "book", "added": true, "stamped": { "added": "2026-09-05" } }
// kore untag Dune book --json
{ "path": "notes/dune.md", "tag": "book", "removed": true }
```

### `kore done <text> [--in <note>] [--undo] [--json]`

Ticks a task off by its text: an exact (case-insensitive) match, else a
unique substring match; `--undo` reopens a completed task. Zero or several
matches exit `3` (the candidates are listed on stderr). Graph-wide, the
index's tasks projection finds the task (exit `4` without it); with
`--in <note>` the note's own lines do, so a task captured a moment ago is
tickable before the app re-indexes. The file on disk is the truth for the
write — the marker line must be present exactly once as a list item
outside fenced code (at its indexed offset or moved), else the command
refuses (exit `1`) rather than toggling the wrong line. Only the three
marker characters change.

```jsonc
// kore done "pay bill" --in 2026-09-05 --json
{ "path": "daily/2026-09-05.md", "text": "pay bill", "checked": true }
```

### `kore append <note> <text> [--stdin] [--json]`

Appends a markdown block — headings, paragraphs, lists — after one blank
line, in the note's own line ending. A daily target may not exist yet
(created); any other target must. Private targets are refused. Pipe longer
content with `--stdin`.

```jsonc
// printf '## Notes\n\n- one\n' | kore append Dune --stdin --json
{ "path": "notes/dune.md", "absolutePath": "/…/graph/notes/dune.md", "created": false, "bytesAppended": 16 }
```

### `kore edit <note> --old <text> --new <text> [--json]`

Replaces one exact passage of the note's body: the CLI's twin of the in-app
chat's `edit_note` (`applyNoteEdit`). `--old` must occur in the body exactly
once; otherwise nothing is written and the command exits `2` (not found, or
more than once). That is the guard: an agent passes the text it read, so an
edit never lands on a note that changed since (typed in the app, edited by
another agent); it re-reads and retries. An empty `--old` appends `--new` to
the end of the body. Frontmatter is out of reach (use `set`); private notes
are refused (exit `3`). Text sent with LF line breaks is written in a CRLF
note's own ending.

```jsonc
// kore edit Plan --old "Ship in May." --new "Ship in June." --json
{ "path": "notes/plan.md", "absolutePath": "/…/graph/notes/plan.md", "appended": false }
```

## For agents

The commands above plus `--json` are the supported automation surface (e.g.
`~/.agents` discovery workflows). The JSON field names and exit codes above
are stable; new fields may be added, existing ones won't change meaning.
Reading or writing a private note is not possible through this surface by
design — don't work around it by reading graph files directly unless the
user asked for that. The intended loop is discover → read → write:
`info`/`tags` to learn what exists, `collection`/`properties` to learn a
row's keys and types, then `new`/`set`/`tag`/`done`/`append`/`edit` instead of
hand-written YAML.

Settings → Agents installs the bundled agent skills under
`~/.agents/skills/` (`apps/desktop/src-tauri/skills/`, one folder each):

| Skill | Teaches |
|---|---|
| `kore-graph-<graph-slug>` | This contract for one graph: its root, the bundled CLI's path, the commands, the privacy rules. Rendered per graph. |
| `kore-markdown` | The note format: layout, titles, wiki links, tags, tasks, frontmatter, templates. |
| `kore-collections` | Supertags and their schemas, property types and their YAML values, the ` ```collection ` fence, reusable collections. |
| `kore-agent-memory` | The `agents/` folder: user profile, shared facts and log, souls, working memory, pending proposals, vault skills. |

The shared three are installed once, verbatim; the graph skill points at
them for formats. Every file carries a `reflect-managed` sha256 marker so
the app can refresh its own installs without ever overwriting a hand-edited
one (`apps/desktop/src-tauri/src/skill.rs`).

## MCP server

`kore mcp` speaks the Model Context Protocol (JSON-RPC over stdio,
revisions 2025-06-18, 2025-03-26 and 2024-11-05), so Claude Desktop, Claude
Code, Cursor, Codex and any other MCP client can use the graph as tools
without a skill or a shell. Settings → Agents → MCP server shows the config
to paste, with the bundled CLI path and the open graph's root filled in:

```json
{ "mcpServers": { "kore": { "command": "/Applications/Kore.app/Contents/MacOS/kore",
                            "args": ["--graph", "/path/to/graph", "mcp"] } } }
```

or, for Claude Code, `claude mcp add kore -- <cli> --graph <root> mcp`.

Each tool runs one subcommand above as a child process with `--json`, so the
output contract, the structural writes and the privacy rule are exactly the
CLI's: a private note is as invisible to an MCP client as to `kore show`.
Arguments travel as argv after `--`, never through a shell. A command that
fails (not found, private, no index) comes back as a tool result with
`isError: true` and the CLI's message, not as a protocol error.

| Tool | Runs |
|---|---|
| `vault_guide` | `guide` |
| `search`, `read_note`, `today`, `backlinks`, `links`, `note_properties` | `search`, `show`, `today`, `backlinks`, `links`, `properties` |
| `list_notes`, `recent_notes`, `list_tags`, `collection`, `list_tasks`, `graph_info` | `list`, `recent`, `tags`, `collection`, `tasks`, `info` |
| `explain_note`, `path_between_notes`, `grep_notes`, `list_skills`, `load_skill`, `active_note` | `explain`, `route`, `grep`, `skills`, `skills <name>`, `active` |
| `capture`, `append_to_note`, `edit_note`, `create_note`, `set_properties` | `capture`, `append --stdin`, `edit`, `new` (body on stdin), `set` |
| `tag_note`, `untag_note`, `complete_task` | `tag`, `untag`, `done` |
| `remember` | `capture` (to today's daily, or `--to <note>`) |
| `library_sources`, `library_files`, `library_grep`, `library_read` | `library sources`, `library files`, `library grep`, `library read` (stdio only) |

In a vault whose `AGENTS.md` frontmatter declares `cyber_brain:` (Plan 35),
memory belongs to the vault's own kit, so the memory tools change:
`remember` (kit fact line), `open_loop`, `update_loop`, `close_loop` and
`record_decision` each run `kore brain`, which runs the vault's
`brain.mjs`. The result is the kit's own: the same fact line, run record
and commit as Claude Code writes, signed with the calling agent's name.
`--memory-only` lists only `vault_guide` and these tools (the Kore chat
attaches the server this way, beside its own file tools), and `--agent
<name>` names a stdio client for the run records.

`remember` is the shared-memory verb: one fact as a signed bullet,
`[likely] The fact (previously: old) — Grok bot, 2026-11-04`. The
confidence tag is `certain`, `likely` (default) or `speculative`; the name
is the calling agent's own when it connected with a named key (see below),
whatever name it claims, else the `agent` argument.

The four `library_*` tools read the agent folders of the machine `kore
mcp` runs on, so only the stdio server offers them. `kore mcp --http` never
lists them and refuses them if called, whatever the key: a remote agent
reaches the vault, never your home folder.

`search` takes an optional `mode` (`hybrid` by default, `lexical`,
`semantic`), so an agent searches the way the in-app chat does.
`edit_note` takes `note`, `oldText` and `newText` (the chat tool's names).

`vault_guide` is the tool to call first. The server's `initialize`
`instructions` carry the vault's contract too (up to 12,000 characters,
then a pointer to `vault_guide`), so a client that injects server
instructions starts every session under the vault's rules, whether it
connects over stdio or `--http`, and ChatGPT- or Grok-style clients that
only use tools still reach them through `vault_guide`.

`--read-only` drops the writing tools (the last three rows) from `tools/list`
and refuses them if called. Tools carry `readOnlyHint` and
`destructiveHint` annotations either way, so clients that confirm writes can
tell them apart: `edit_note`, the one tool that replaces existing text, is
the only one marked destructive.

Resources are the notes themselves, addressed by the app's deep links, so a
URI an agent cites opens the note in Kore and a link copied from the app
reads back:

| URI | Reads |
|---|---|
| `kore://note/<note>` | `show` — a URI-encoded path, frontmatter id, title, or alias |
| `kore://daily/<date>`, `kore://today` | `show <date>`, `today` |
| `kore://tasks` | `tasks` (JSON) |
| `kore://guide` | `guide` (JSON) |

`resources/list` pages every public note newest first (1000 a page, from
`list`), as `kore://note/<encoded path>`, after `kore://today`,
`kore://tasks` and `kore://guide`. A private or missing note is a `-32002` error carrying the
CLI's message.

Prompts embed notes as resources and only ask the model to read and
propose, so `--read-only` keeps them: `daily_review` (`date`, default
today: the daily note and open tasks), `weekly_review` (the last seven
dailies, other notes changed since, open tasks) and `connect_note` (`note`:
the note with its links and backlinks, asking which links are missing).

### Remote access over HTTP

In the Mac app, Settings → Agents → Remote access does all of this for the
open graph: it makes and keeps the token in the keychain, runs the server
on `127.0.0.1:8765` while Kore is open, and publishes it with Tailscale
Funnel. The rest of this section is for running it by hand.

`kore mcp --http <addr>` serves the same tools, resources and prompts over
MCP's Streamable HTTP transport (stateless: `POST /mcp` with JSON in and
out, no SSE stream), for agents that cannot launch a local process: Claude
on the web and the phone, cloud agents, API clients such as Grok's or
OpenAI's remote MCP tools.

```sh
export KORE_MCP_TOKEN="$(openssl rand -hex 32)"   # keep it somewhere safe
kore --graph ~/Notes mcp --http 127.0.0.1:8765
tailscale funnel 8765                              # or a Cloudflare Tunnel
```

The server binds a local address and never terminates TLS; the tunnel
supplies the public HTTPS URL (pass it with `--public-url` if the tunnel
does not forward the `Host` header). The owner's secret, `KORE_MCP_TOKEN`
(at least 24 characters), guards everything, and each named agent can have
its own key:

- **API clients** send the token or a key as `Authorization: Bearer <key>`.
- **Claude and ChatGPT** (custom connector at `<public url>/mcp`) sign in with OAuth.
  The server is its own single-user authorization server: discovery
  metadata, dynamic client registration, an authorize page that asks for
  the token, PKCE S256, refresh. Codes and tokens are HMAC-signed with a key
  derived from the token, so they survive a restart and changing
  `KORE_MCP_TOKEN` revokes every connection. Access tokens last an hour,
  refresh tokens 30 days.
- OAuth redirects go only to Claude's and ChatGPT's callbacks and loopback
  addresses; `--redirect-uri <uri>` (repeatable) allows another client's.
- **`GET /setup.md`** is the one public page: the server's MCP URL, how
  each client connects, and how to use the vault. It holds no secret, so a
  user can tell any agent "read <url>/setup.md and connect to my Kore".

**Named agents.** `kore keys add "Grok bot"` prints a new key once
(`--write` lets that agent use the writing tools; keys are read-only by
default). With `--propose` the agent sees the writing tools, but each call
is kept in `.kore/proposals/` instead of written: `kore proposals` lists
them, `kore proposals accept <id>` writes one signed as that agent (checked
again exactly like a direct call), `reject <id>` drops it. The agent signs in with it like the token, as a bearer header or
on the "Connect to Kore" page; then what it `remember`s carries its name,
and `kore keys remove "Grok bot"` disconnects it alone, OAuth tokens
included, at its next request. `kore keys list` shows names and permissions,
never keys. The keys live in `$KORE_MCP_KEYS_FILE`, else
`$XDG_CONFIG_HOME/kore/mcp-agents.json`, else `~/.config/kore/mcp-agents.json`
(mode 0600, outside the vault), and the server reads that file on every
request, so none of this needs a restart or the app. The Mac app keeps its
own list in the keychain and passes it as `KORE_MCP_AGENTS` (a JSON list of
`{id, name, key, access}`, where `access` is `read`, `propose` or `write`;
an older `write: true|false` is still read).

`--read-only` applies here too. Search, tags, backlinks, lists and tasks
read the index the Kore app keeps, so run the server where the app has the
graph open.

**Without the Mac.** On a server that holds a git clone of the vault, build
the index once and add `--sync`; the server then answers every tool the Mac
would and keeps the clone in step with its remote:

```sh
kore --graph ~/vault index
kore --graph ~/vault mcp --http 127.0.0.1:8765 --sync   # --sync-every 60 (seconds)
```

`--sync` pulls and reindexes in the background, and commits and pushes every
agent write (author `Kore host`). It never merges text: a write that
collides with a Mac edit is re-run as the same CLI operation on top of the
Mac's version, and one that no longer applies is dropped and logged.
`kore sync [--json]` runs one such pass by hand
(`{ "pulled", "pushed", "replayed", "dropped", "reindexed", "offline"? }`).
The design, the Docker image and the systemd unit are in
[always-on.md](always-on.md).

## Development notes

- The CLI deliberately duplicates a thin contract from `@kore/core`
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
  --workspace`, run `pnpm --filter @kore/desktop sidecar` once.
