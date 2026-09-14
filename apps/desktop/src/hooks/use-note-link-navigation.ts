import { useCallback } from 'react'
import { useOptionalPanes, usePaneId } from '@/providers/panes-provider'
import type { NoteRoute } from '@/routing/route'
import { useRouter } from '@/routing/router'

/** Open one concrete note from a link-like UI control. */
export type NoteLinkNavigation = (options: { target: NoteRoute; openInSplit: boolean }) => void

/**
 * The app-wide note-link convention: `openInSplit` (decided at the UI
 * boundary from a ⌘/Ctrl click or a spare-`mod` keyboard follow) opens the
 * note in the pane beside this one; otherwise navigate in place. Surfaces
 * without panes (the secondary note window, mobile) navigate in place either
 * way, so the modifier can never make a link do nothing.
 */
export function useNoteLinkNavigation(): NoteLinkNavigation {
  const { navigate } = useRouter()
  const panes = useOptionalPanes()
  const paneId = usePaneId()

  return useCallback(
    ({ target, openInSplit }) => {
      if (openInSplit && panes !== null) {
        panes.openInPane(target, { from: paneId })
        return
      }
      navigate(target)
    },
    [navigate, panes, paneId],
  )
}
