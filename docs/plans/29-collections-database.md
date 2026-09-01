# Plan 29 — Collections as databases: typed relations first

**Status:** Direction set 2026-08-31 (user request: collections must be real
databases — relating to one another, working like Notion databases or Tana
supertags). R1/N1/R2/R3/V1a shipped in the first wave; V1b and T1 shipped
2026-09-01. Formulas remain.
**Outcome:** A typed tag behaves like a database of its own: its relations
point at other collections (and can create their rows), its rows read as rows,
and derived values stay views over the markdown truth.
**Navigation:** [TDR 0005](../decisions/0005-tag-types-and-collections.md) ·
[TDR 0006](../decisions/0006-personal-os-boundaries.md) ·
[Plan 25 I14–I15](25-personal-os.md#i14--structured-objects-and-database-contract) ·
[STATE](../STATE.md).

## Constraints carried in whole

Everything here stays inside the recorded contracts: schemas and values live
in markdown (`tags/<name>.md` + each note's frontmatter, TDR 0005), relations
stay wiki links, and neither stable-ID relations nor moving schema ownership
into SQLite happens without the serialization decision TDR 0006 / Plan 25 I14
reserve. Every slice below is a view or a picker over the existing truth.

## The gap this plan closes

The machinery is already real — 14 property types, table/board/calendar,
filters, saved views, inline edits, CSV both ways, `prop:` search, chat tools,
CLI. What separates it from "a database" is relational and presentational:

1. **Relations were untyped.** A `relation` pointed at *any* note through the
   global `[[` picker — no target collection, no create-from-picker, no
   reverse side.
2. **Rollups stop at count/empty/original/unique** — no sum/avg/min/max, no
   formulas (I15 direction).
3. **A row doesn't present as a row**: properties live in the context rail
   only; no properties header above the note body.
4. **Membership is note-level**: a daily note *mentioning* `#book` becomes a
   `#book` row with every column empty. Tana puts the supertag on the node;
   the collection needs to separate rows from mentions.
5. **Embeds carry only `tag:` and `view:`** — no filtered linked views.
6. **View gaps**: no table grouping, single-key sort, no multiselect board
   lanes, hash-only select colors, no created/updated/person/phone types.

## Slices

- **R1 — Typed relations** *(shipped this wave)*. A `relation`/`relations`
  property may declare `target: <tag>` in the schema; the picker then offers
  only that collection's rows (`suggestRelationTargets`, the same verified
  addresses as the `[[` autocomplete, scoped through the `tags` projection)
  plus a "Create in #target" entry that births a titled row carrying the tag
  and links it in one gesture. The target scopes the picker, never the value:
  a stored link pointing elsewhere still displays and survives. Storage is
  unchanged — the value stays a wiki link, the target one schema key.
- **R2 — Reverse relations (view-only)** *(shipped this wave)*. The `reverse`
  property type, configured on the definition alone ("rows of `tag` whose
  `property` links here", the dialog's Of/Via), computed by
  `attachReverseRelations` from the collection + resolution the forward
  direction already maintains — Notion's two-way feel without writing both
  sides. Absent when nothing links, so footers count honestly.
- **R3 — Rollup sum/avg/min/max** *(shipped this wave)*: numeric
  aggregations over sources that carry a number (never coerced), rounded to
  two decimals for display.
- **M1 — Membership** *(decided 2026-08-31, user)*: **the hashtag is the
  supertag.** Writing `#tag` anywhere — a daily note included — deliberately
  makes that note an instance, so membership stays exactly what TDR 0004/0005
  derive from the body and no row/mention split is built. An instance with
  empty columns is a row awaiting values, not noise.
- **N1 — Properties above the note body** *(shipped this wave)*: the row
  page — `NotePropertiesHeader`, sharing the rail section's hook and field
  face, skipped on daily notes.
- **V1a — Embeds with `sort:`/`filter:` lines** *(shipped this wave)*: the
  fence gained `sort: <key> [asc|desc]` and `filter:` lines in the filter
  menu's vocabulary (`key = v`, `key ~ v`, `key > n`, `key < n`,
  `key is empty`, `key is set`) — parsed tolerantly (a malformed line is
  skipped, never the fence), round-tripped by the serializer, applied by the
  widget through the same `applyCollectionFilters` the tag page uses. A
  linked, arranged view in portable text.
- **V1b — Table row grouping** *(shipped 2026-09-01)*. A table-view "Group
  by" (None + the board's groupable set — select/status/checkbox/relation/
  person) persisted per tag as `collectionTableGroups`, where absence means
  *flat*: the flat table is a first-class shape, not a degraded board. The
  shelves are the board's own lanes (`tableGroupRows` wraps `boardColumns`)
  with two table-shaped differences — rows keep the incoming sort instead of
  the manual rank, and empty lanes disappear (a table renders no empty shelf
  to drop onto). The screen computes the groups so the selection's flat
  order and the shelves can never disagree; the virtualizer renders header
  items between rows, and keyboard navigation maps row → item index through
  the same computation. Saved views snapshot `tableGroup` (nullable —
  applying a flat view un-groups; pre-V1b saves apply as flat).
- **T1 — created/updated, person, phone** *(shipped 2026-09-01)*. The
  design refined against the vault's reality:
  - `created` is a **frontmatter stamp** written once when Kore itself
    births the row (table/board/calendar "+", the relation picker's
    "Create in #tag"), not filesystem birthtime — a git clone or an iCloud
    copy silently rewrites birthtime, while the stamp survives any sync. A
    note tagged into the collection by hand keeps an empty cell (its
    history predates the membership); a CSV import's historical date wins
    over the stamp. Read-only in the UI.
  - `updated` stores **nothing**: cells are attached view-only from the
    row's indexed mtime (`attachTimestampColumns`, the reverse columns'
    honesty contract — absent at mtime 0, a hand-written value never shows
    through), and a sort on its key rides the `$updated` sentinel
    (`effectiveCollectionSort`) since the property join would read every
    row as missing.
  - `person` is a **relation in person's clothing**: the same wiki-link
    value, the picker scoped to `#person` by default (`relationTargetOf`;
    a `target:` key overrides), create-from-picker included, rendered as
    an initials disc + name; boards group by it (lanes alphabetical, like
    relations).
  - `phone` is text with a `tel` input; filters treat the stamps as dates
    (is/>/</empty/set) and person/phone as text.
  Formulas stay queued — last, projection-only, per I15.

Order: R1 → N1 → R2 → R3 → V1a → V1b → T1 (all shipped); M1 decided, no
build. Remaining in this plan: formulas (projection-only), and two smaller
view gaps if appetite returns — multiselect board lanes, `group:` in the
embed fence.
