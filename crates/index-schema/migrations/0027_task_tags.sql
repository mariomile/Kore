-- The tags written on a task's own marker line (`- [ ] call Andrea #lead`),
-- as a JSON array of folded keys. A tag there makes the line a row of that
-- tag's database (organization point 4); the tag page reads them by key. A
-- column, not a table: a vault holds a few thousand tasks, the tag page scans
-- them once per open, and renames and deletes keep riding the tasks row.
-- Rebuildable projection: the PROJECTION_VERSION bump fills existing rows.
ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
