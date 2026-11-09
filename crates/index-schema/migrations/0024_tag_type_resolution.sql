-- Tags that build on other tags (Plan 33 B2).
--
-- A definition's `extends:` makes its effective schema depend on other
-- definitions, and its parent's collection lists its notes. The policy for
-- both lives in TypeScript (`resolveTagTypes`, packages/core/src/tags/
-- tag-inheritance.ts); after every write that touches a definition, core
-- recomputes all of it and stores the result here, so every reader (the
-- app, `kore` and `kore mcp`) reads one answer instead of resolving again.
--
-- * `resolved_json` — the effective schema, in `schema_json`'s format.
-- * `public_resolved_json` — the same with private definitions left out,
--   for outbound surfaces; NULL when this definition is itself private.
-- * `descendants_json` / `public_descendants_json` — JSON arrays of the
--   folded tags that build on this one, directly or not.
--
-- All four are NULL until core's inheritance pass stores the row, and a
-- NULL reads as untyped (never as the raw `schema_json`, which could leak
-- a private parent's fields outbound). This migration ships with a
-- projection bump (`PROJECTION_VERSION` 29), so an existing index is
-- rebuilt on first open and the pass fills every row before anything reads
-- it; every later open runs the pass once more.
--
-- (This file is numbered 0024 because an unregistered 0023_fts_rowid.sql
-- already sits in this folder; it is the 23rd migration.)
ALTER TABLE tag_types ADD COLUMN resolved_json TEXT;
ALTER TABLE tag_types ADD COLUMN public_resolved_json TEXT;
ALTER TABLE tag_types ADD COLUMN descendants_json TEXT;
ALTER TABLE tag_types ADD COLUMN public_descendants_json TEXT;
