import { sql, type RawBuilder } from 'kysely'
import { foldTag } from '../markdown'

/**
 * Does the note at `notePathColumn` carry `tag` or a tag nested under it?
 * Obsidian's prefix semantics, the same as Bases' `hasTag`: `#domain` matches
 * `#domain/ai` but not `#domains`. The nested half is a key range (`0` is the
 * character after `/`), so it stays on the `tags.tag_key` index and needs no
 * LIKE escaping for the `_` a tag may contain. An `EXISTS`, so a note carrying
 * several nested tags still yields one row. Both arguments are raw SQL column
 * references (snake_case, quoted), never user input.
 */
export function carriesTagOrNested(notePathColumn: string, tag: string): RawBuilder<boolean> {
  const key = foldTag(tag)
  return sql<boolean>`exists (
    select 1 from "tags" as "filter_tags"
    where "filter_tags"."note_path" = ${sql.raw(notePathColumn)}
      and ("filter_tags"."tag_key" = ${key}
        or ("filter_tags"."tag_key" >= ${`${key}/`} and "filter_tags"."tag_key" < ${`${key}0`}))
  )`
}
