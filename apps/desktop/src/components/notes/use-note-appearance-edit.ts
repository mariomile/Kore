import { useCallback } from 'react'
import { errorMessage } from '@reflect/core'
import { commitNoteFrontmatter } from '@/lib/note-frontmatter'
import { startOperation } from '@/lib/operations'

/**
 * Writes the note header's chrome keys (`icon:`) through the shared
 * frontmatter path, so an open editor takes the patch into its live header.
 * Failures surface on the operations status line. Null when no vault
 * generation is known yet: the header then renders read-only.
 */
export function useNoteAppearanceEdit(
  path: string,
  generation: number | null,
): ((icon: string | null) => void) | null {
  const setIcon = useCallback(
    (icon: string | null): void => {
      if (generation === null) {
        return
      }
      commitNoteFrontmatter(path, { icon }, generation).catch((cause: unknown) => {
        startOperation('Changing the note icon').fail(errorMessage(cause))
      })
    },
    [path, generation],
  )
  return generation === null ? null : setIcon
}
