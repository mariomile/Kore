# Plan 29 — Collections as databases: typed relations first

**Status:** Direction set 2026-08-31 (user request: collections must be real
databases — relating to one another, working like Notion databases or Tana
supertags). Slice R1 shipped in this wave.
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
- **M1 — Membership.** Decide the row/mention split (default the collection to
  non-daily notes carrying the tag, with mentions listed apart) — a semantic
  change, taken to the user before building. Line-level supertags à la Tana
  would be Meowdown work and are out of scope here.
- **N1 — Properties above the note body** (queued in STATE): the row page.
- **V1 — Embeds with `filter:`/`sort:` keys** (portable text, like `view:`),
  and table row grouping.
- **T1 — created/updated (from the index, read-only), person, phone;**
  formulas last, projection-only, per I15.

Order: R1 → N1 → R2 → R3 (all shipped); M1 once decided; V1/T1 next.
