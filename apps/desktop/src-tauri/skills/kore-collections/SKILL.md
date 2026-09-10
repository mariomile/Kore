---
name: kore-collections
description: Work with Kore collections — tags as supertags with a property schema, typed frontmatter values (relations, dates, selects, ratings, rollups, formulas), the ```collection fence with views/sort/filter/group, and reusable collection definitions. Use when the user mentions collections, supertags, properties, a database view of notes, table/board/calendar, or when creating or filling typed rows in a Kore graph.
---

# Kore collections

Every tag is a collection: its rows are the notes carrying `#tag`, its
columns are the properties the tag's schema declares. Values live in each
note's own frontmatter; the schema lives in a definition note. Nothing is
stored anywhere else, so every surface (table, board, calendar, note
properties panel, CLI, AI chat) reads and writes the same YAML.

Read before writing: `reflect tags` lists the tags and which are typed,
`reflect collection <tag> --json` shows a tag's `schema` and rows,
`reflect properties <note>` shows what a note carries now. Write values
with `reflect set` / `reflect new --tag --set`; they type the value for
you. Hand-write YAML only when the CLI is unavailable, following the table
below exactly.

## The definition note

`tags/<tag>.md` marked `lore: tag`. Both the path and the marker are
required. The body is the tag's description (rendered on its page).

```yaml
---
lore: tag
properties:
  - { name: Author, key: author, type: relation, target: person }
  - { name: Rating, key: rating, type: rating }
  - { name: Status, key: status, type: status, options: [Reading, Done] }
  - { name: Added, key: added, type: created }
template: templates/book.md
---
# book

Books I read or want to read.
```

- `name` is the label; `key` is the flat frontmatter key (letters, digits,
  `_`, `-`; never one of the app's reserved keys). Keys are shared across
  tags Obsidian-style: two schemas declaring `author` read the same value.
- `template` binds a note template that seeds new rows.
- A tag with no definition note is still a collection (Title and Updated
  columns); the first property saved writes the definition. Prefer the
  app's schema dialog for schema edits; when writing one by hand keep the
  exact shape above.

## Property types and their frontmatter values

| `type` | Frontmatter value | Example |
|---|---|---|
| `text`, `url`, `email`, `phone` | string | `email: ann@example.com` |
| `number` | number | `pages: 412` |
| `rating` | integer 1–5 | `rating: 4` |
| `checkbox` | `true` / `false` | `read: true` |
| `date` | `YYYY-MM-DD` string | `read-on: 2026-09-10` |
| `select`, `status` | one of `options` (others tolerated, flagged) | `status: Reading` |
| `multiselect` | list of strings | `genres: [scifi, classic]` |
| `relation`, `person` | one wiki link, `"[[Title]]"` (quoted in YAML) | `author: "[[Ursula K. Le Guin]]"` |
| `relations` | list of wiki links | `people: ["[[Ann]]", "[[Bob]]"]` |
| `files` | list of `assets/` paths | `files: [assets/cover.jpg]` |
| `created` | `YYYY-MM-DD`, stamped when Kore births the row | `added: 2026-09-10` |
| `updated` | **view-only** (indexed mtime) — never written | — |
| `rollup`, `reverse`, `formula` | **view-only**, configured on the definition — never written on rows | — |

A `relation` with `target: <tag>` scopes the picker to that collection;
`person` defaults to `#person`. The stored value is always the plain
`[[Title]]` link, so it survives outside the app.

## View-only columns (definition only)

```yaml
  - { name: Pages read, key: pages-read, type: rollup,
      rollup: { relation: books, property: pages, aggregation: sum } }
  - { name: Books, key: books, type: reverse,
      reverse: { tag: book, property: author } }
  - { name: Score, key: score, type: formula,
      formula: { expression: 'if(prop("read"), prop("rating") * 20, 0)' } }
```

- `rollup.aggregation`: `count`, `empty`, `original`, `unique`, `sum`,
  `average`, `min`, `max`, over the related rows' `property`.
- `reverse`: "rows of `tag` whose `property` links here" — two-way relations
  without writing both sides.
- `formula.expression` — a small pure language over the row's own values:
  literals, `prop("key")`, `+ - * /` (`+` concatenates text), `== != > <
  >= <=`, `and / or / not`, and `if(c, a, b)`, `concat(…)`,
  `round(n[, digits])`, `abs`, `min`, `max`, `length(text)`, `empty(x)`,
  `format(x)`. A missing value makes numeric/boolean work empty, not an
  error. No I/O, no cross-row reads.

## Rows

A row is a note carrying the tag. Born the way the app does it:

```markdown
---
rating: 4
added: 2026-09-10
author: "[[Ursula K. Le Guin]]"
---
# The Dispossessed

Body from the bound template, then your notes.

#book
```

`reflect new "The Dispossessed" --tag book --set rating=4 --set "author=Ursula K. Le Guin"`
produces exactly this (template body, `created` stamp, typed values, trailing
tag). Turn an existing note into a row with `reflect tag <note> book`; set or
change values with `reflect set <note> key=value`.

## The collection fence

A live view of a collection inside any note. Portable: every line is
readable markdown.

````markdown
```collection
tag: book
view: table
sort: rating desc
sort: $title
filter: status = Reading
filter: rating > 3
match: any
group: status
hide: added
```
````

- First line: `tag: <tag>` (or a bare `<tag>`), or `collection: <reference>`
  for a reusable definition (its stable `id`, path fallback).
- `view`: `table` (default), `grid`, `board`, `calendar`. Board needs a
  `select`/`status`/`multiselect` column to lane by; calendar a `date`.
- `sort: <key> [asc|desc]`, repeatable (a chain); `$title` and `$updated`
  are always available.
- `filter:` — `key = value` (is), `key ~ value` (contains), `key > n`,
  `key < n`, `key is empty`, `key is set`; repeatable. `match: any` makes
  them alternatives (default: all).
- `group: <key>` groups table rows; `hide: <key>` hides a column
  (repeatable).

## Reusable collections (mixed notes)

A named selection across tags, itself an ordinary note:

```yaml
---
koreCollection: true
kore:
  collection:
    version: 1
    sources:
      tags: [project, initiative]          # alternatives (union)
      relation: { key: owner, target: "[[Mario]]" }   # constrains tag matches
      include: ["[[Loose note]]"]          # added explicitly
      exclude: ["[[Archived]]"]            # removed last
    create:
      tag: project
      properties: { status: active }
---
# Active work
```

Rows keep their own values; columns are the union of the schemas of the
tags present. A fence renders it with `collection: <that note's id>`.
Formula, rollup, reverse and timestamp columns apply only to rows carrying
the declaring tag.

## Rules

1. **Values on the row, schema on the definition.** Never write `rollup`,
   `reverse`, `formula`, `properties`, or `lore` on a member note.
2. **Discover the schema before writing a key.** An undeclared key becomes
   an untyped stray column.
3. **Relations are wiki links to titles that exist.** Create the target
   first (`reflect new`), then link it.
4. **Dates are `YYYY-MM-DD`, ratings 1–5, checkboxes `true`/`false`.**
   The app shows a mismatch tint for anything else and never repairs it.
