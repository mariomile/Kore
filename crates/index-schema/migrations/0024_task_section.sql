-- The section a task sits in: the nearest top-level heading above it (level 2
-- or deeper), or null. The Tasks view's Projects lists a project's tasks under
-- these sections. Rebuildable projection: the TypeScript PROJECTION_VERSION
-- bump reindexes notes so existing rows pick up their sections.
ALTER TABLE tasks ADD COLUMN section TEXT;
