import type { ReactElement } from 'react'
import { isModEvent } from '@meowdown/core'
import { displayNoteTitle, noteFileStem } from '@reflect/core'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { useNoteRow } from '@/hooks/use-note-row'
import { routeForPath } from '@/routing/route'
import { LocalGraphBody } from './local-graph-section'

interface LocalGraphScreenProps {
  /** Graph-relative path of the note the map centers on. */
  path: string
}

/**
 * The Details panel's local graph opened as a page: the same map, depth and
 * tag controls, filling the pane instead of a strip of the rail. The header
 * names the note and links back to it (⌘-click opens it beside).
 */
export function LocalGraphScreen({ path }: LocalGraphScreenProps): ReactElement {
  const navigateNoteLink = useNoteLinkNavigation()
  const row = useNoteRow(path)
  const title = displayNoteTitle(row?.title ?? noteFileStem(path))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-baseline gap-3 px-6 pb-2 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Local graph</h1>
        <button
          type="button"
          onClick={(event) => {
            navigateNoteLink({ target: routeForPath(path), openInSplit: isModEvent(event) })
          }}
          className="min-w-0 truncate rounded text-xs font-medium text-text-secondary hover:text-text hover:underline"
        >
          {title}
        </button>
      </div>
      <LocalGraphBody path={path} layout="page" />
    </div>
  )
}
