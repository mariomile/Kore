---
name: {{SKILL_NAME}}
description: Read, search, capture, and edit notes in the user's "{{GRAPH_NAME}}" Kore graph via the `reflect` CLI. Use when the user asks about their notes, daily notes, journal, tasks, collections, or anything they may have written down in Kore. The kore-markdown, kore-collections, and kore-agent-memory skills carry the formats.
---

# Kore graph: {{GRAPH_NAME}}

Kore is a local-first, markdown-backed note-taking app. This skill targets
one graph (a folder of notes):

    {{GRAPH_ROOT}}

Read it through the `reflect` CLI rather than scanning the files — the CLI
resolves titles, aliases, and daily dates, searches the graph's ranked index,
and enforces the privacy contract.

## The CLI

Use `reflect` from PATH when available; the app also bundles the binary at:

    {{CLI_PATH}}

Always target the graph explicitly so calls stay deterministic:

    reflect --graph "{{GRAPH_ROOT}}" <command>

or export `REFLECT_GRAPH="{{GRAPH_ROOT}}"` for a sequence of calls.

## Commands

Discover first, then read, then write. Every command takes `--json`.

    reflect info               # graph root, index state, note/daily/tag counts
    reflect tags               # every tag with its count; "collection" = typed
    reflect list [--tag T] [--kind daily|note]   # notes newest first, with tags
    reflect collection <tag>   # a typed tag's rows with their property values
    reflect properties <note>  # a note's frontmatter properties, typed, and tags
    reflect links <note>       # the wiki links a note makes, resolved

    reflect today              # print today's daily note
    reflect today --path       # its absolute path (works before the file exists)
    reflect search <query>     # ranked full-text search over the graph
    reflect show <note>        # print a note by date, path, title, or alias
    reflect path <note>        # resolve a note to its absolute path
    reflect open <note>        # open the note in the Kore app
    reflect tasks              # the graph's open tasks (--all includes done)
    reflect backlinks <note>   # the notes linking to a note
    reflect recent             # the most recently updated notes, newest first

    reflect capture <text>     # append a bullet to today's daily note
    reflect capture --task <text>        # append an open task instead
    reflect capture --to <note> <text>   # append to any note instead
    reflect capture --stdin              # the text from stdin
    reflect append <note> <text>         # append a markdown block (or --stdin)
    reflect new <title>                  # create notes/<slug>.md with the H1 in place
    reflect new <title> --tag <tag> --set key=value   # a typed collection row
    reflect new <title> --template <t>   # seed the body from templates/
    reflect set <note> key=value…        # write frontmatter properties, typed
    reflect set <note> --unset key       # remove a property
    reflect tag <note> <tag>             # add a #tag (trailing line)
    reflect untag <note> <tag>           # remove that trailing #tag line
    reflect done <text> [--in <note>]    # tick a task off (--undo reopens it)

- Add `--json` to any command for stable machine-readable output — the field
  names and exit codes are the supported automation contract.
- `<note>` resolves in order: `YYYY-MM-DD` date, graph-relative path, title,
  then alias (case-insensitive) — a note you just created resolves right
  away. A miss prints "did you mean" titles on stderr.
- The app re-indexes a few seconds after a write. Reads that need the index
  (`search`, `tasks`, `list`, `collection`) may lag that long; `done --in
  <note>` and every `<note>` resolution read the file itself and never lag.
- stdout carries only data; warnings and errors go to stderr.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | runtime error (no graph, IO failure, a write that would not verify) |
| 2 | usage error, or a value the command cannot honour (bad type, reserved key, view-only property) |
| 3 | note or task not found, ambiguous, or private |
| 4 | index missing (index-backed commands) — open the graph in Kore once to build it |

## Writing notes

Use the CLI's writes — they are typed, atomic, and never overwrite:

- **Items and content.** `reflect capture` for one bullet or task (today's
  daily by default — where all capture flows by convention — or `--to` any
  note); `reflect append` for a block of markdown (headings, paragraphs,
  lists) — pipe it with `--stdin`.
- **Notes and rows.** `reflect new` creates a note with the app's own
  filename slug and H1. With `--tag` it is a collection row: the type's
  template seeds the body, `created` properties are stamped, and `--set`
  values are typed by the schema.
- **Properties.** `reflect set` writes frontmatter the way the app's editors
  do. Run `reflect tags` and `reflect collection <tag>` (its `schema`) first
  to learn the keys and types; `reflect properties <note>` shows what a note
  carries now. Numbers, checkboxes (`true`/`false`), dates (`YYYY-MM-DD`),
  ratings (1–5) are checked; relations take a title and become `[[Title]]`;
  lists are comma-separated. The app's own keys (`id`, `private`, `pinned`,
  `aliases`, …) and computed properties (`rollup`, `reverse`, `formula`,
  `updated`) are refused.
- **Tags and tasks.** `reflect tag` / `reflect untag` for membership in a
  collection; `reflect done` to tick a task by its text.

Only for in-place prose edits, edit the markdown file directly
(`reflect path <note>` resolves it); the running app watches the files and
picks every edit up live.

The formats are their own skills, installed beside this one by Kore:
`kore-markdown` (layout, titles, wiki links, tags, tasks, frontmatter,
templates), `kore-collections` (supertags, property types, the
` ```collection ` fence, reusable collections), and `kore-agent-memory`
(the `agents/` folder: user profile, shared facts, session log, souls,
vault skills). Read the one a task touches before writing by hand.

## Git history

On desktop, every graph is also a Git repository at its root. Kore
initializes or adopts that repo when the graph opens; even graphs with no
backup remote keep local history through a commit-only sync loop. There may be
no `origin`, but `.git` history is available.

Use the CLI for current note lookup, privacy filtering, and path resolution.
Use Git only when the user asks for history, diffs, recovery, or past states:

    git -C "{{GRAPH_ROOT}}" log --oneline -- <graph-relative-path>
    git -C "{{GRAPH_ROOT}}" diff <rev> -- <graph-relative-path>
    git -C "{{GRAPH_ROOT}}" show <rev>:<graph-relative-path>

Do not use Git history to bypass privacy. If a note is private, avoid reading
or exposing its current or historical content unless the user explicitly asks.

## Rules

1. **Respect privacy.** Notes with `private: true` frontmatter are invisible
   through the CLI by design — no content, no paths, no search hits, no
   writes into them. Never work around this by reading graph files directly
   unless the user explicitly asks for that.
2. **Write through the CLI.** `capture`/`append` add, `new` creates, `set`
   types frontmatter, `tag`/`untag` and `done` change exactly one line —
   nothing overwrites. Never hand-edit frontmatter, `.reflect/`, or a task
   marker when a command does it.
3. **Discover before writing.** `reflect tags` and `reflect collection
   <tag>` tell you the keys and types a row takes; `reflect properties
   <note>` tells you what is there. Guessing a key creates an untyped stray.
4. **Prefer search over enumeration.** `reflect search` uses the app's own
   ranked index; don't grep the whole graph when a search will do.
