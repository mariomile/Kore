# Plan 31 — Converting an Obsidian vault to Kore's layout

> **Status (2026-11-02):** Slice 1 (dry run) in progress. Reopens one
> non-goal of [Plan 13](13-import-export-portability.md) on the user's
> decision.

## Why

On 2026-11-02 Mario, after the October work that taught Kore to read an Obsidian
vault in place, set the direction: Kore must not change how it works to match
Obsidian; an Obsidian vault should be migrated into Kore's shape instead.
Granola and Readwise get native integrations later and are out of scope.

## The line: format stays, layout converts

- **Format** is what is inside a Markdown file: wiki links (aliases, paths,
  `#headings`), frontmatter `tags:` (Kore's own way to write a type since
  TDR 0005 Amendment D), bare `![[photo.png]]` embeds, callouts. These are
  Markdown conventions, and Kore keeps reading them natively.
- **Layout** is where files live and how they are named: the daily folder and
  filename format, the attachment folder, the templates folder, the new-note
  folder, ignore filters. Today the vault profile
  (`packages/core/src/graph/vault-layout.ts`) adapts Kore to these at runtime.
  The importer converts them once instead.

## What the conversion does

Planned in `packages/core/src/obsidian-import/` (pure, shared by the dry run
and the conversion):

- dailies `Journal/Daily/DD-MM-YYYY.md` → `daily/YYYY-MM-DD.md`; every link to
  a daily, by path or by its old file name, becomes Kore's date link
  `[[YYYY-MM-DD]]`, keeping display text and `#fragment`;
- the attachment folder → `assets/` (the path below the folder kept), with
  path embeds and Markdown image links repointed; bare names stay, the file
  keeps its name;
- the templates folder → `templates/`;
- a destination that is taken (case-folded) leaves the file in place and is
  reported;
- every other note keeps its path: Kore reads notes in any folder, and
  flattening five thousand notes would only create name collisions;
- each converted note is checked with the editor's round-trip classifier:
  `normalizing` notes are written canonically so the first edit afterwards
  changes only what the user typed, `lossy` notes are copied untouched and
  listed;
- plugin syntax (Dataview, Templater, …) is carried as written and reported
  through the compatibility scan.

## Slices

1. **Dry run** (this slice): Settings → Sync & data → *Convert to Kore layout*
   reads every note of the open Obsidian vault, plans the moves, rewrites links
   in memory, classifies, and reports. Writes nothing.
2. **Conversion to a copy**: pick an empty destination folder; Rust copies and
   writes (a new command, thin), core decides every byte. The source vault is
   never written. Open the copy as a Kore graph when done.
3. **Bases**: simple `.base` views (filters on tags and properties) become
   supertag views; the rest stay readable and are reported.
4. **Retire the runtime profile** (decided by the user 2026-11-02, after the
   conversion has run on a real vault): an un-imported Obsidian vault then
   opens with Kore's layout, and the importer becomes the only path.

## Out of scope

Granola and Readwise syncing, two-way sync with Obsidian, converting plugin
syntax, renaming notes.
