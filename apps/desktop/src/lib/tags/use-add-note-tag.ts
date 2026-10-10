import { useCallback } from 'react'
import {
  addNoteTag,
  errorMessage,
  getTagType,
  missingCreatedStamps,
  upsertFrontmatter,
} from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { commitNoteBodyTransform } from '@/lib/note-frontmatter'
import { useGraph } from '@/providers/graph-provider'
import { invalidateOnNextIndexApply } from './use-commit-note-property'

/**
 * Set a tag on a note from the Type field — the write behind the type picker,
 * and the mirror of `useRemoveNoteTag`. The tag lands in frontmatter `tags:`
 * (TDR 0005 amendment), so typing a note never touches its text; the note's
 * properties header shows it as a chip.
 *
 * The tag and the type's `created` stamps land in **one** transform, so a
 * half-applied membership is impossible: the note either joins the collection
 * with its stamps or stays byte-identical. A note that already carries the
 * tag from either source is left alone (`addNoteTag` returns null), stamps included — a
 * second set must not move an existing date.
 */
export function useAddNoteTag(): (path: string, tag: string) => Promise<void> {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  return useCallback(
    async (path: string, tag: string) => {
      if (generation === null) {
        return
      }
      try {
        // Read before the write: the schema decides which stamps exist, and
        // an untyped tag simply has none.
        const type = await getTagType(tag)
        await commitNoteBodyTransform(
          path,
          (source) => {
            const tagged = addNoteTag(source, tag)
            if (tagged === null) {
              return source
            }
            return upsertFrontmatter(tagged, missingCreatedStamps(tagged, type))
          },
          generation,
        )
        invalidateOnNextIndexApply()
      } catch (error: unknown) {
        toast.add({
          type: 'error',
          title: "Couldn't set the type",
          description: errorMessage(error),
        })
      }
    },
    [generation],
  )
}
