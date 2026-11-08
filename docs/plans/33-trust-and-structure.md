# Plan 33 — Trust and structure (ideas taken from Fennick)

> **Status (2026-11-08):** A1 (steps 1-7) done on
> `claude/project-thread-xdktwu`, PR #343; the other slices wait for Mario's go. Italian analysis for Mario:
> `/mnt/project-files/analisi/fennick.md` (project files).

## Why

Mario (2026-11-08) studied Fennick (getfennick.com), a pre-alpha notes app
built on the same idea as Kore: one place where you and your agents work on
the same notes. Kore is ahead on *reach* (remote MCP, named agent keys, the
vault's agent contract, context capture). Fennick is ahead on two things:

1. **Trust.** Its Op Log lists every change by every person and agent,
   grouped into sittings, and undoes one sitting while keeping later work.
2. **Structure.** A tagged line is already a database record, and outliner
   gestures (zoom into a bullet, move a branch) work on any list.

This plan takes both while keeping notes plain Markdown.

## Rules for the whole plan

- **One step = one commit, pushed.** Each step leaves the app working, so a
  bad step is reverted alone. One PR per slice; the next slice starts from
  `master` after Mario merges the previous one.
- **Markdown stays the source of truth.** Nothing here adds ids to every
  line or moves data out of `.md` files.
- **Meowdown is a third-party package** (Mario, 2026-11-08). Editor features
  are Kore ProseMirror plugins (like `apps/desktop/src/editor/link-card-plugin.ts`);
  a pnpm patch in `patches/` only when no plugin can do it.
- **No editor rendering changes in the database slices.** Records are read
  from the index and written by core rewriting one line, the way the task
  inline editor already does.
- **Tasks belong to the Todoist thread.** B1 (checkboxes as records with
  schema fields) waits until that thread's slices merge, then builds on them.
  B3's natural-language dates align with its Quick Add parser.

## Order

| # | Slice | Depends on | Size |
|---|---|---|---|
| A1 | Vault activity log, per agent, with undo | — | L |
| A2 | Agent keys in "propose" mode | A1 step 1 | M |
| A3 | "Who wrote what" in a note | A1 | S |
| B2 | Tags that build on other tags | — | S |
| B4 | Starting values for fields | — | S |
| C1 | Zoom into a list item | — | M |
| C3 | Line references with `^id` | — | M |
| C2 | Move a branch to another note | C3 | S |
| B3 | Natural-language dates in fields, `@fri` links | Todoist Quick Add | M |
| B1 | Checkboxes and tagged list lines as records | Todoist slices | L |
| B5 | Week and month pages | B3 | S |

## A1 — Vault activity log

Goal: every change an agent makes is visible and reversible in at most two
clicks. Non-goals: per-keystroke history, attributing Obsidian vs Kore edits
(everything unsigned is "you"), vaults without git (empty state with the
existing "turn on backup").

1. **CLI signs host commits per agent.** `Runner` gains `run_as(args, stdin,
   agent)` (default: `run`). `Mcp::call` passes the caller's name.
   `VaultSync` commits a named caller's write with author `<Name>` /
   `<slug>@agents.kore` and a `Kore-Agent: <Name>` trailer; the owner stays
   `Kore host`. The journal keeps the agent so a replay signs the same way.
2. **CLI records local agent writes.** `ProcessRunner` passes the agent to
   the child (`KORE_AGENT`); every write through `atomic_write` /
   `atomic_create` appends `{at, agent, path}` to
   `.reflect/agent-writes.jsonl`. The app's backup commit stages journaled
   paths in their own commit signed like step 1, then everything else as
   today.
3. **Rust primitive `git_activity`.** Paged log: oid, time, author, trailers,
   changed paths. No grouping or labels.
4. **Core `activity` module.** Groups commits into sittings (same author,
   gaps under 30 minutes), labels authors (`Kore-Agent` trailer, host, else
   "you"), zod-validated binding.
5. **Desktop "Activity" screen.** Opened from the command palette and the
   sidebar. Sittings newest first, grouped by day, author filter, notes per
   sitting; a note row opens the existing history dialog on that commit.
6. **Undo a sitting.** Rust primitive reverse-applies a sitting's commits per
   file with a three-way merge and refuses the whole undo on any conflict,
   naming the notes. Core asks for confirmation; the undo is one commit by
   the owner.
7. **Docs.** `docs/STATE.md`, `docs/delivery-log.md`, the Meowdown wording in
   `CLAUDE.md`/`AGENTS.md`.

## A2 — "Propose" agent keys

`kore keys add <name> --propose`: writes from that key are not applied but
queued in `.reflect/proposals/` (one JSON per write: the CLI args and a diff
preview). The app lists them with the existing `ChatProposalCard`; accept
runs the queued command signed as the agent (A1 step 1), reject drops it.

## A3 — Who wrote what

A toggle in the note menu shades each line by its last author, from
`git blame` over A1's signed commits. Agent lines carry the agent's mark.

## B2 — Tags that build on other tags

A tag definition gains `extends: [contact]`. Its schema is the parent's
fields plus its own (own wins on a name clash); the parent's collection also
lists members of child tags, with a "only #contact itself" filter. Loops are
refused when the definition is saved.

## B4 — Starting values for fields

A schema field gains `default`: `today`, `now`, `next-number`, or a fixed
value. Applied once when a note joins the tag through Kore (new note, Type
field, `set_note_type`); hand-edited Markdown is never stamped.

## C1 — Zoom into a list item

A Kore ProseMirror plugin: clicking a bullet (or `⌘.`) shows only that item
and its children, with a breadcrumb back. Nothing is written to the file.

## C3 — Line references with `^id`

Render and resolve Obsidian block ids: `[[Note#^id]]` opens the note at that
line, `![[Note#^id]]` transcludes the line and its children. "Copy link to
line" adds an id only to that line. Mario's vault already has 869 ids and 12
references (measured 2026-11-08).

## C2 — Move a branch

`⌘⇧M` moves the current list item and its children to the end of a picked
note, leaving nothing behind and updating `^id` links that pointed at it.

## B3, B1, B5

Specified after the Todoist thread's slices merge, on top of its task model
and Quick Add parser. B1 must start from checkboxes (3,791 in Mario's vault,
40 tagged), not from tagged lines (73).
