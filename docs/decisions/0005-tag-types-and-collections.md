# TDR 0005 — Tag types and collections: a tag may own a schema

- **Status:** Accepted
- **Date:** 2026-08-23
- **Scope:** The tag-type model (Tana-style supertags): per-tag property
  schemas, the `note_properties`/`tag_types` index projections, and the
  Collection view over notes carrying a typed tag.
- **Supersedes:** the "tags aren't first-class objects" clause of
  [TDR 0004](0004-all-notes-trash-and-tag-scope.md), **for typed tags only**.
  Untyped tags keep TDR 0004's model in full: derived from note bodies, no
  stored entity, no CRUD UI, select-only filter bar.

---

## TL;DR

**A tag can now own a type.** Creating `tags/<name>.md` with a `lore: tag`
frontmatter marker turns the tag into a type with a property schema; every
note carrying `#<name>` becomes a row in that tag's Collection — a table with
one typed column per schema property, whose values live in each note's own
frontmatter.

---

## Decision 1 — The definition is a markdown note in the graph

A tag's schema lives in `tags/<name>.md` (the folded tag name), marked
`lore: tag`, with the schema under a `properties:` frontmatter key:

```yaml
---
lore: tag
properties:
  - { name: Author, key: author, type: text }
  - { name: Rating, key: rating, type: number }
  - { name: Status, key: status, type: select, options: [to-read, reading, done] }
---
Free body: describe the type.
```

Why a note and not app settings or `.reflect/`: the schema is graph content —
it must sync (Git/iCloud), survive index rebuilds, be editable outside the
app, and travel with an exported vault. `.reflect/` is a local-only
rebuildable cache and settings are app-level; both fail those tests. The
`agents/` tree set the precedent: markdown with config frontmatter,
"user-visible, editable, linkable, synced".

**Both conditions are required** — path *and* marker. A pre-existing user note
under `tags/` keeps `kind='note'` untouched until explicitly converted; a
marker outside `tags/` defines nothing. Definition notes are indexed as
`notes.kind = 'tag'`: openable and linkable (they keep their `note_claims`),
excluded from note-listing surfaces exactly like templates.

Property types (V1): `text · number · checkbox · date · select · multiselect
· url`. Property `key`s are flat frontmatter keys shared across tags,
Obsidian-style — two tags declaring `author` read the same value. That is a
feature (one fact, one key), not a collision to namespace away.

## Decision 2 — Values live in each note's frontmatter; the index carries a generic projection

A note's property values are ordinary frontmatter keys (`author: Le Guin`,
`rating: 4.5`). Markdown stays the source of truth; any external editor can
read and write them.

The index projects **every** non-reserved scalar (or scalar-list) frontmatter
key of **every** note into `note_properties` (migration 0021), regardless of
any schema. Indexing only schema-declared keys was rejected: it would make
row contents depend on the mutable state of a definition note, so every
schema edit would demand re-indexing every note carrying the tag. Reserved
keys (`id`, `title`, `aliases`, `private`, `pinned`, `gist`,
`ignoredContacts`, `lore`, `properties`) are never projected and never
writable through a properties patch (`frontmatterPatchToYaml` drops them).

`tag_types` projects each definition's parsed schema (`schema_json`), so
"which tags are typed" is one lookup. Both tables are rebuildable projections;
migration 0021 rebuilds `notes` for the widened `kind` CHECK (the 0015
recipe) and the PROJECTION_VERSION bump (19 → 20) forces the re-index.

## Decision 3 — Collections are a view mode of All Notes, not a new surface

The Collection table is a third All Notes view mode (`list · grid · table`),
offered when the routed tag has a type. The route stays
`{ kind: 'allNotes', tag }`; columns derive from `schema_json`; cell edits
write through the frontmatter patch channel (live session first, disk
fallback). No table library — the existing CSS-grid + virtua idiom.

## Known consequences

- Retitling a definition note through the ordinary rename pipeline would move
  it out of `tags/` and silently untype the tag. The tag config surface edits
  frontmatter in place and never retitles; a hand-move converges like any
  external move (heal + reproject).
- Case-variant duplicate definitions (`tags/Book.md` + `tags/book.md` on a
  case-sensitive FS) contend for one `tag_key`; the last indexed write wins
  (`INSERT OR REPLACE`) and the state converges when either file changes.
- `private: true` notes appear in Collections — the privacy flag blocks
  external services, not local surfaces.
- Tag notes are reachable by search and wiki links (intended: the supertag is
  a node); they stay out of All Notes, recents, and the daily stream via the
  existing `kind = 'note'` filters.
