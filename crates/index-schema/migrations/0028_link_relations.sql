-- Named relations on links.
--
-- A frontmatter wiki link is the value of a key (`company: "[[Acme]]"`,
-- `expertise:` then `- "[[Product Discovery]]"`). `relation` keeps that key,
-- so the graph tells a `company` edge from a bare mention in a daily note;
-- body links hold NULL. The `backlinks` view carries it through unchanged.
-- Rebuildable projection: the PROJECTION_VERSION bump (34) fills existing rows.

ALTER TABLE links ADD COLUMN relation TEXT;

DROP VIEW backlinks;

CREATE VIEW backlinks AS
  -- Name-addressed wiki links resolve through the ranked key map. A wiki
  -- link that also spells a path joins here only when that path matches no
  -- note, mirroring the resolver's exact-file-first order. A row with no
  -- name reading (target_key = '') can never join: no claim is ''.
  SELECT k.note_path AS target_path, l.source_path, l.kind, l.target_raw,
         l.alias, l.relation, l.pos_from, l.pos_to
  FROM links l
  JOIN note_keys k ON k.key = l.target_key
  JOIN notes source ON source.path = l.source_path AND source.kind != 'template'
  WHERE l.kind = 'wiki' AND l.target_key != ''
    AND (l.target_path_key IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM notes t
        WHERE t.path_key = l.target_path_key AND t.kind != 'template'
      ))

  UNION ALL

  -- Path-addressed links (wiki or Markdown) name exactly one file, so they
  -- need no ranking. A path that matches nothing produces no row here; a
  -- wiki link with a name reading falls back to the branch above instead.
  SELECT t.path AS target_path, l.source_path, l.kind, l.target_raw,
         l.alias, l.relation, l.pos_from, l.pos_to
  FROM links l
  JOIN notes t ON t.path_key = l.target_path_key AND t.kind != 'template'
  JOIN notes source ON source.path = l.source_path AND source.kind != 'template'
  WHERE l.target_path_key IS NOT NULL;
