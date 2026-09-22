import { useCallback } from 'react'
import {
  appendBodyTag,
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
 * and the mirror of `useRemoveNoteTag`. The hashtag is still the supertag
 * (TDR 0005), so this appends `#tag` on its own trailing line exactly as the
 * editor, the bulk action and `reflect tag` do; the note's properties header
 * then shows it as a chip and the editor collapses the line, so the user sees
 * a field, not prose.
 *
 * The tag and the type's `created` stamps land in **one** transform, so a
 * half-applied membership is impossible: the note either joins the collection
 * with its stamps or stays byte-identical. A note that already carries the
 * tag is left alone (`appendBodyTag` returns null), stamps included — a
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
            const tagged = appendBodyTag(source, tag)
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
