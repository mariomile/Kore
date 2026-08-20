---
name: {{SKILL_NAME}}
description: Read, search, capture, and edit notes in the user's "{{GRAPH_NAME}}" Reflect graph via the `reflect` CLI. Use when the user asks about their notes, daily notes, journal, tasks, or anything they may have written down in Reflect.
---

# Reflect graph: {{GRAPH_NAME}}

Reflect is a local-first, markdown-backed note-taking app. This skill targets
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

    reflect today              # print today's daily note
    reflect today --path       # its absolute path (works before the file exists)
    reflect search <query>     # ranked full-text search over the graph
    reflect show <note>        # print a note by date, path, title, or alias
    reflect path <note>        # resolve a note to its absolute path
    reflect open <note>        # open the note in the Reflect app
    reflect tasks              # the graph's open tasks (--all includes done)
    reflect backlinks <note>   # the notes linking to a note
    reflect recent             # the most recently updated notes, newest first
    reflect capture <text>     # append a bullet to today's daily note
    reflect capture --task <text>       # append an open task instead
    reflect capture --to <note> <text>  # append to any note instead
    reflect new <title>        # create notes/<slug>.md with the H1 in place
    reflect new <title> --template <t>  # seed the body from templates/

- Add `--json` to any command for stable machine-readable output — the field
  names and exit codes are the supported automation contract.
- `<note>` resolves in order: `YYYY-MM-DD` date, graph-relative path, title,
  then alias (case-insensitive).
- stdout carries only data; warnings and errors go to stderr.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | runtime error (no graph, IO failure) |
| 2 | usage error |
| 3 | note not found, or note is private |
| 4 | index missing (`search`/`tasks`/`backlinks`/`recent`) — open the graph in Reflect once to build it |

## Writing notes

Prefer the CLI's structural writes: `reflect capture` for quick additions
(today's daily by default — where all capture flows by convention — or
`--to` any note) and `reflect new` to create a note with the app's own
filename slug, H1, and optional template seeding. For anything bigger, edit
the markdown file directly (`reflect path <note>` resolves it); the running
app watches the files and picks every edit up live. Follow the graph's
conventions so edits render as first-class notes:

- **Layout.** Dailies are `daily/YYYY-MM-DD.md`; new notes go in
  `notes/<kebab-case-title>.md`; templates in `templates/`; attachments in
  `assets/`. Never write into `.reflect/` (the app's index) or `assets/` by
  hand.
- **Titles.** A note's title is its first `# H1`, or the file name without
  `.md` when there is none. Dailies have no H1 — the date is the title.
- **Wiki links.** `[[Exact Title]]` links notes; `[[YYYY-MM-DD]]` links a
  daily. Backlinks and the graph view update automatically. Link generously —
  association is the graph's organizing model.
- **Tasks.** A task is a round checkbox: `+ [ ] text` open, `+ [x] text`
  done. A leading `!` (medium) or `!!` (high) right after the marker sets
  priority; the first `[[YYYY-MM-DD]]` inside the item is its due date.
  Square `- [ ]` checkboxes are simple checklists and stay out of the
  Tasks view.
- **Frontmatter.** Optional YAML: `private: true` hides a note from AI and
  this CLI; `aliases: [Other Name]` adds link targets. Never invent or edit
  an `id:` — the app mints those. Preserve frontmatter you don't understand.
- **Templates.** Files in `templates/` seed new notes; the placeholders
  `{{date}}`, `{{date:iso}}`, `{{time}}`, and `{{title}}` fill on use.
- **Agents.** The `agents/` folder is the graph's agent home, injected into
  the app's own AI sessions too: `agents/user.md` holds durable facts about
  the user (shared by every agent); each profile lives at
  `agents/<slug>/soul.md` (identity and voice — the user's file, respect it)
  and `agents/<slug>/memory.md` (that agent's working memory). Read them
  before longer tasks; record what you learn — user facts in `user.md`,
  your own lessons in the profile memory. Keep entries short and curated;
  never store secrets or content from private notes.

## Git history

On desktop, every graph is also a Git repository at its root. Reflect
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
   captures into them. Never work around this by reading graph files directly
   unless the user explicitly asks for that.
2. **The CLI's writes are structural only.** `capture` appends, `new`
   creates — nothing overwrites. Everything else changes by editing the
   markdown file the CLI resolves (`reflect path <note>`); the running app
   picks the edit up. Never edit `.reflect/` or rewrite frontmatter you
   don't understand.
3. **Prefer search over enumeration.** `reflect search` uses the app's own
   ranked index; don't grep the whole graph when a search will do.
