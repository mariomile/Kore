-- Optional local time of day on a dated task, stored as `HH:MM` (24-hour).
-- Authored in markdown as `@HH:MM` immediately after the task's first
-- `[[YYYY-MM-DD]]` due-date link. Null means date-only (existing behavior).
-- Rebuildable projection: the TypeScript PROJECTION_VERSION bump reindexes
-- notes so existing rows pick up times from markdown.
ALTER TABLE tasks ADD COLUMN due_time TEXT;
