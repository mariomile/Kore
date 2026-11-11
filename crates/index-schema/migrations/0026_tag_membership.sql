-- Whether a tag row is membership or a mention. A note *is* a #tag when the
-- tag sits in its frontmatter `tags:` or in a tag-only first or last body
-- paragraph (`member = 1`); a `#tag` written inside prose only mentions it
-- (`member = 0`). Collections, the Types tree, the Type field and relation
-- pickers read members; search, the graph and the tag page's "Mentioned in"
-- section also read mentions. Rebuildable projection: the PROJECTION_VERSION
-- bump reindexes every note, so the default only covers the gap until then.
ALTER TABLE tags ADD COLUMN member INTEGER NOT NULL DEFAULT 1;

-- Membership filters read the flag next to the key they already seek on, so
-- the (tag_key, note_path) lookups stay index-only.
DROP INDEX tags_tag_key_note_path;
CREATE INDEX tags_tag_key_note_path ON tags(tag_key, note_path, member);
