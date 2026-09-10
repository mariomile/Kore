---
name: kore-markdown
description: Read and write notes in a Kore graph — the markdown conventions Kore renders and indexes: folder layout, titles, wiki links and embeds, #tags, round-checkbox tasks with due dates, frontmatter (private, aliases, pinned, cover, icon), templates. Use when creating or editing .md files in a Kore graph, or when the user mentions Kore notes, daily notes, wiki links, tasks, or frontmatter.
---

# Kore markdown

Kore is a local-first note app. A graph is a folder of `.md` files; the app
watches the files and indexes them into `.reflect/index.sqlite`, a
rebuildable projection. **Markdown is the source of truth.** Anything you
write following these conventions renders as a first-class note; anything
else stays visible as plain markdown, never corrupted, never hidden.

Prefer the `reflect` CLI for structural writes (see the graph's own skill,
`reflect-<graph>`): it types frontmatter, appends items, creates notes and
tags atomically. Edit the file directly only for prose.

## Layout

| Path | What lives there |
|---|---|
| `daily/YYYY-MM-DD.md` | Daily notes, created lazily on first write. All quick capture lands here by convention. |
| `notes/<kebab-title>.md` | Regular notes. The filename is derived from the title; Kore renames the file when the title changes. |
| `tags/<tag>.md` | A tag's definition note (its schema and description) — see the `kore-collections` skill. |
| `templates/*.md` | Templates that seed new notes; `templates/daily.md` seeds today's daily. |
| `assets/` | Pasted and dropped files. Never write here by hand. |
| `agents/` | Agent profiles and memory — see the `kore-agent-memory` skill. |
| `.reflect/` | The app's index. Never write here. |

Any other `.md` file anywhere in the graph is an ordinary note too;
hidden folders (`.git`, `.reflect`) and `assets/` are excluded.

## Titles

A note's title is its first `# H1`, or the filename without `.md` when it
has none. Dailies have no H1 — the date is the title. Keep exactly one H1
at the top; a second H1 is body text.

## Wiki links

- `[[Exact Title]]` links a note by title (case-insensitive); `[[2026-09-10]]`
  links a daily. `[[Title|shown text]]` changes the display text.
- Titles, aliases (`aliases:` in frontmatter), and filename stems all
  resolve; a `#fragment` after the title is ignored (Kore does not navigate
  to headings).
- `![[photo.png]]` embeds a file from `assets/`; it is an attachment, not a
  link to a note.
- Link generously: association is the graph's organizing model. Backlinks
  and the graph view derive from these links automatically.

## Tags

A tag is written inline in the body: `#book`, `#sci-fi/classic`. Grammar:
a letter, then letters, digits, `/`, `_`, `-`. Tags are not read from
frontmatter (`tags:` there is an ordinary property, not membership).
Writing `#tag` anywhere in a note, a daily included, makes the note a
member of that tag's collection — "the hashtag is the supertag". The
conventional place for a membership tag is one trailing line at the end
of the body, which is what the app and the CLI write.

## Tasks

- `+ [ ] text` is an open task, `+ [x] text` a done one. The round `+`
  bullet is Kore's own task syntax; `- [ ]` and `* [ ]` checkboxes are the
  same task written in ordinary markdown and project to the Tasks view too.
- A leading `!` (medium) or `!!` (high) right after the marker sets
  priority: `+ [ ] !! Pay the invoice`.
- The first calendar-valid `[[YYYY-MM-DD]]` inside the item is its due
  date; `@HH:MM` right after that link is its due time:
  `+ [ ] Call Ann [[2026-09-12]] @15:30`.
- Checkboxes in ordered lists and inside code fences are not tasks.

## Frontmatter

Optional YAML between `---` fences at the very top. Kore reads these keys:

| Key | Meaning |
|---|---|
| `id` | Durable identity (a ULID). **The app mints it — never invent or edit one.** |
| `private: true` | Hard privacy block: the note never reaches any external service, AI, or the CLI. |
| `aliases: [Other Name]` | Extra link targets. |
| `pinned: true` (or a number for order) | Pinned in the sidebar. |
| `cover: assets/photo.jpg` / `icon: ✨` | Note chrome (image path, `![[embed]]`, https URL, or an emoji). |
| `gist`, `ignoredContacts`, `lore`, `properties`, `template`, `kore`, `koreCollection` | App-owned; do not write by hand. |

Every other scalar or list-of-scalars key is a **property** the index
projects and collections render (see `kore-collections`). Nested objects
are kept but not indexed. Preserve frontmatter you do not understand; a
block that is not valid YAML makes the note read as having none.

## Templates

A file under `templates/` seeds new notes (by name or H1 title). Its own
frontmatter is stripped on use; the body may carry `{{date}}` (user's
format), `{{date:iso}}` (`YYYY-MM-DD`), `{{time}}`, and `{{title}}`. A
template that opens with its own `# H1` owns the note's structure. A
`private: true` template is never copied into a public note.

## Rules

1. **Never bypass `private: true`.** Do not read, quote, or write into a
   private note unless the user explicitly asked for that note.
2. **Never write `id:`, `.reflect/`, or `assets/` by hand.**
3. **Keep edits minimal:** change the lines you mean to change, keep the
   note's line endings, keep the frontmatter block intact.
