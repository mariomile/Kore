import { useMemo } from 'react'
import { errorMessage } from '@kore/core'
import { commitNoteFrontmatter } from '@/lib/note-frontmatter'
import { startOperation } from '@/lib/operations'
import type { FrontmatterPatch } from '@/editor/note-session-frontmatter'

/** Setters for the note header's chrome keys; `null` removes the key. */
export interface NoteAppearanceEdit {
  setIcon: (icon: string | null) => void
  setCover: (cover: string | null) => void
}

/**
 * Writes the note header's chrome keys (`icon:`, `cover:`) through the shared
 * frontmatter path, so an open editor takes the patch into its live header.
 * Failures surface on the operations status line. Null when no vault
 * generation is known yet: the header then renders read-only.
 */
export function useNoteAppearanceEdit(
  path: string,
  generation: number | null,
): NoteAppearanceEdit | null {
  return useMemo(() => {
    if (generation === null) {
      return null
    }
    const commit = (patch: FrontmatterPatch, label: string): void => {
      commitNoteFrontmatter(path, patch, generation).catch((cause: unknown) => {
        startOperation(label).fail(errorMessage(cause))
      })
    }
    return {
      setIcon: (icon) => commit({ icon }, 'Changing the note icon'),
      setCover: (cover) => commit({ cover }, 'Changing the note cover'),
    }
  }, [path, generation])
}
