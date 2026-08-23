import { useCallback } from 'react'
import { resolveWikiTarget } from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { routeForPath } from '@/routing/route'

/**
 * Navigate to a relation's target note (TDR 0005): resolve the wiki target
 * through the same claims machinery as a body link, then follow it. An
 * unresolvable target (the note was deleted, or the value is a stale title)
 * says so instead of navigating nowhere.
 */
export function useOpenRelation(): (target: string) => void {
  const navigateNoteLink = useNoteLinkNavigation()
  return useCallback(
    (target: string) => {
      void resolveWikiTarget(target).then((resolution) => {
        if (resolution.kind === 'resolved') {
          navigateNoteLink({ target: routeForPath(resolution.ref), openInNewWindow: false })
        } else {
          toast.add({
            type: 'info',
            title: `No note answers to “${target}”`,
            description: 'The linked note may have been renamed or deleted.',
          })
        }
      })
    },
    [navigateNoteLink],
  )
}
