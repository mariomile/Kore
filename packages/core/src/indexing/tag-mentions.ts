import { sql } from 'kysely'
import { foldTag } from '../markdown'
import { db } from './db'
import { carriesTagOrNested } from './tag-match'

/** A note whose prose mentions a tag without being one of its rows. */
export interface TagMention {
  readonly path: string
  readonly title: string
}

/**
 * The notes that mention `tag` (or a tag nested under it) inside their prose
 * but are not members of it — the tag page's "Mentioned in" list, newest
 * first. Members are the collection's rows; a mention is a reference, the
 * way a backlink is.
 */
export async function listTagMentions(tag: string): Promise<TagMention[]> {
  const key = foldTag(tag)
  return await db
    .selectFrom('notes')
    .where('notes.kind', 'in', ['note', 'daily'])
    .where(
      sql<boolean>`exists (
        select 1 from "tags" as "mention_tags"
        where "mention_tags"."note_path" = "notes"."path"
          and "mention_tags"."member" = 0
          and ("mention_tags"."tag_key" = ${key}
            or ("mention_tags"."tag_key" >= ${`${key}/`} and "mention_tags"."tag_key" < ${`${key}0`}))
      )`,
    )
    .where(sql<boolean>`not ${carriesTagOrNested('"notes"."path"', tag)}`)
    .select(['notes.path', 'notes.title'])
    .orderBy('notes.mtime', 'desc')
    .orderBy('notes.path')
    .execute()
}
